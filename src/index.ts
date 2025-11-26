import express, { Request, Response } from 'express';
import { CONFIG } from './config';
import * as WeChatService from './services/wechatService';

// Extend global type
declare global {
  var processedMsgIds: Set<string>;
}

const app = express();

// Middleware to handle raw XML body
app.use(express.text({ type: ['text/xml', 'application/xml'] }));

/**
 * GET Route: WeChat Server Verification
 * Used when configuring the server URL in WeChat Admin
 */
app.get('/', (req: Request, res: Response) => {
  const { signature, timestamp, nonce, echostr } = req.query;

  if (signature && timestamp && nonce) {
    if (WeChatService.validateSignature(signature as string, timestamp as string, nonce as string)) {
      console.log('WeChat Signature Verified');
      return res.send(echostr);
    }
  }

  console.log('Signature verification failed');
  return res.status(401).send('Invalid Signature');
  // return res.status(200).send('It is work!');

});

/**
 * POST Route: Receive Messages
 * WeChat sends messages here via XML
 */
app.post('/', async (req: Request, res: Response) => {
  const { signature, timestamp, nonce, openid } = req.query;
  console.log('Received message from WeChat:', req.body);
  // Security check (Optional but recommended)
  if (!WeChatService.validateSignature(signature as string, timestamp as string, nonce as string)) {
    return res.status(401).send('Invalid Signature');
  }

  const xmlData = req.body;

  if (!xmlData) {
    return res.send('success');
  }

  // Deduplication Cache
  // We use a simple Set to store recently processed MsgIds.
  // In production, use Redis or a more robust solution with TTL.
  if (!global.processedMsgIds) {
    global.processedMsgIds = new Set<string>();
  }

  try {
    // 1. Parse XML
    const result = await WeChatService.parseXML(xmlData);
    if (!result || !result.xml) {
      return res.send('success');
    }

    const message = result.xml;
    const msgId = message.MsgId;

    if (msgId && global.processedMsgIds.has(msgId)) {
      console.log(`Duplicate message ${msgId} detected. Ignoring.`);
      return res.send('success');
    }

    if (msgId) {
      global.processedMsgIds.add(msgId);
      // Optional: Cleanup old IDs periodically or use a LRU cache
      setTimeout(() => global.processedMsgIds.delete(msgId), 60000); // Clear after 1 minute
    }
    let isResponseSent = false;

    // 2. Create the AI Task
    // We wrap it to handle the "Late Reply" scenario
    const aiTask = WeChatService.processMessage(message).then(async (reply) => {
      if (!isResponseSent) {
        console.log('Response sent successfully', reply);
        // If we haven't timed out, return the reply to the main flow
        return reply;
      } else {
        // Timeout happened, HTTP response is already sent.
        // We must send the result via Custom Service Message
        console.log('Response timed out. Sending via Custom Message API...');
        await WeChatService.sendCustomMessage(message.FromUserName, reply);
        return null; // Return null to indicate handled
      }
    });

    // 3. Create Timeout Promise
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null); // Resolve with null to indicate timeout
      }, CONFIG.TIMEOUT_MS);
    });

    // 4. Race
    const winner = await Promise.race([aiTask, timeoutPromise]);

    if (winner) {
      // AI finished in time
      isResponseSent = true;
      const xmlResponse = WeChatService.replyToXml(message.FromUserName, message.ToUserName, winner);
      res.type('application/xml');
      res.send(xmlResponse);
    } else {
      // Timeout won
      isResponseSent = true;
      console.log('Processing timed out. Returning empty success to WeChat.');
      res.send('success');
      // aiTask continues in background
    }

  } catch (error) {
    console.error('Error processing request:', error);
    res.send('success');
  }
});

// Start Server
app.listen(CONFIG.PORT, () => {
  console.log(`WeChat AI Service running on port ${CONFIG.PORT}`);
  console.log(`Configure your WeChat Admin URL to: http://chat.chenmychou.cn:${CONFIG.PORT}/`);
  console.log(`Token: ${CONFIG.WECHAT_TOKEN}`);
});
