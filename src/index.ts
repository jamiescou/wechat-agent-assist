import express, { Request, Response } from 'express';
import { CONFIG } from './config';
import * as WeChatService from './services/wechatService';

// Extend global type
declare global {
  var processedMsgIds: Set<string>;
  var responseCache: Map<string, { reply: any, timestamp: number }>;
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

  // Response Cache for timeout scenarios
  if (!global.responseCache) {
    global.responseCache = new Map<string, { reply: any, timestamp: number }>();
  }

  try {
    // 1. Parse XML
    const result = await WeChatService.parseXML(xmlData);
    if (!result || !result.xml) {
      return res.send('success');
    }

    const message = result.xml;
    const msgId = message.MsgId;

    // Create a cache key based on user and message content
    const textMsg = message as any;
    const userMessage = textMsg.Content || '';
    const cacheKey = `${message.FromUserName}:${userMessage.trim()}`;

    // Check if we have a cached response for this exact query
    const cached = global.responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 300000)) { // Cache valid for 5 minutes
      console.log('✓ Found cached response for:', userMessage.substring(0, 30));
      const xmlResponse = WeChatService.replyToXml(message.FromUserName, message.ToUserName, cached.reply);
      res.type('application/xml');
      return res.send(xmlResponse);
    }

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

      // Cache the successful response
      global.responseCache.set(cacheKey, { reply: winner, timestamp: Date.now() });
      // Clean up old cache entries (keep last 100)
      if (global.responseCache.size > 100) {
        const firstKey = global.responseCache.keys().next().value;
        global.responseCache.delete(firstKey);
      }

      const xmlResponse = WeChatService.replyToXml(message.FromUserName, message.ToUserName, winner as any);
      res.type('application/xml');
      res.send(xmlResponse);
    } else {
      // Case B: Timeout happened - return a helpful message
      console.log(`⏱ Processing exceeded ${CONFIG.TIMEOUT_MS}ms timeout.`);

      // Return a timeout message immediately
      const timeoutReply: any = {
        type: 'text',
        content: '🔄 您的请求正在处理中...\n\n⏱ 图片生成需要较长时间\n\n💡 请在10-20秒后，重新发送相同的消息（直接复制粘贴），即可立即获取生成的图片链接！'
      };

      const xmlResponse = WeChatService.replyToXml(
        message.FromUserName,
        message.ToUserName,
        timeoutReply
      );
      res.type('application/xml');
      res.send(xmlResponse);

      // Continue processing in background and cache the result
      aiPromise.then(async (reply) => {
        console.log('✓ AI Task Finished (Late):', reply?.type || 'no reply');
        if (reply) {
          // Cache the result so user can retrieve it by resending
          global.responseCache.set(cacheKey, { reply: reply, timestamp: Date.now() });
          console.log('💾 Cached response for key:', cacheKey.substring(0, 50));
          console.log('📝 Result preview:', reply.content?.substring(0, 100) || reply.mediaId);
          console.log('✅ User can now resend the same message to get this result instantly');
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
