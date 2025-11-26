import express, { Request, Response } from 'express';
import { CONFIG } from './config';
import * as WeChatService from './services/wechatService';

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

  try {
    // 1. Parse XML
    const result = await WeChatService.parseXML(xmlData);
    if (!result || !result.xml) {
      return res.send('success');
    }

    const message = result.xml;

    // 2. Process Message with AI (Race against timeout)
    // WeChat expects a response within 5 seconds.

    // Create a promise that rejects after timeout safety margin
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), CONFIG.TIMEOUT_MS);
    });

    try {
      // Race the processing against the timeout
      const responseXml = await Promise.race([
        WeChatService.processMessage(message),
        timeoutPromise
      ]);

      // 3. Send XML Response
      res.type('application/xml');
      res.send(responseXml);

    } catch (err: any) {
      if (err.message === 'TIMEOUT') {
        console.error('Processing timed out. Returning empty success to WeChat to avoid retry loop.');
        // If we timeout, we must strictly return "success" or empty string to stop WeChat from retrying 3 times.
        res.send('success');
      } else {
        throw err;
      }
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
