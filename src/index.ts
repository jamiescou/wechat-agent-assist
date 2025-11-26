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

    // 2. Create the AI Task Promise
    const aiPromise = WeChatService.processMessage(message);

    // 3. Create Timeout Promise
    let timedOut = false;
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, CONFIG.TIMEOUT_MS);
    });

    // 4. Race
    const winner = await Promise.race([aiPromise, timeoutPromise]);

    if (!timedOut && winner) {
      // Case A: AI finished BEFORE timeout
      console.log('✓ AI finished in time. Sending synchronous XML response.');
      const xmlResponse = WeChatService.replyToXml(message.FromUserName, message.ToUserName, winner as any);
      res.type('application/xml');
      res.send(xmlResponse);
    } else {
      // Case B: Timeout happened OR AI failed to return valid data in time
      console.log(`⏱ Processing exceeded ${CONFIG.TIMEOUT_MS}ms timeout. Using async reply.`);
      res.send('success');

      // Handle Late Reply (Async)
      // We wait for the AI promise to finish (if it hasn't already)
      aiPromise.then(async (reply) => {
        console.log('AI Task Finished (Late):', reply?.type || 'no reply');
        if (reply) {
          console.log('→ Sending via Custom Message API (async)...');
          await WeChatService.sendCustomMessage(message.FromUserName, reply);
          console.log('✓ Async message sent successfully');
        } else {
          console.warn('⚠ AI returned empty reply, skipping async message');
        }
      }).catch(err => {
        console.error('✗ AI Task Failed in background:', err.message || err);
      });
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
