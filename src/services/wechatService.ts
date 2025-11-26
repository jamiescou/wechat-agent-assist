import crypto from 'crypto';
import xml2js from 'xml2js';
import { CONFIG } from '../config';
import { WeChatReceivedMessage } from '../types';
import * as AIService from './aiService';

// XML Parser and Builder
const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
const builder = new xml2js.Builder({ rootName: 'xml', cdata: true, headless: true });

/**
 * Validates the request comes from WeChat server.
 * Signature = sha1(sort(token, timestamp, nonce))
 */
export const validateSignature = (signature: string, timestamp: string, nonce: string): boolean => {
  const token = CONFIG.WECHAT_TOKEN;
  const str = [token, timestamp, nonce].sort().join('');
  const sha1 = crypto.createHash('sha1').update(str).digest('hex');
  return sha1 === signature;
};

/**
 * Parses Raw XML string to JSON Object
 */
export const parseXML = async (xml: string): Promise<any> => {
  try {
    return await parser.parseStringPromise(xml);
  } catch (e) {
    console.error('XML Parse Error', e);
    return null;
  }
};

/**
 * Generates the XML response for WeChat
 */
export const buildTextResponse = (toUser: string, fromUser: string, content: string): string => {
  const obj = {
    ToUserName: toUser,
    FromUserName: fromUser,
    CreateTime: Math.floor(Date.now() / 1000),
    MsgType: 'text',
    Content: content
  };
  return builder.buildObject(obj);
};

/**
 * Main Logic to handle the message content
 */
export const processMessage = async (msg: WeChatReceivedMessage): Promise<string> => {
  const { FromUserName, ToUserName, MsgType } = msg;

  let replyContent = '';

  if (MsgType === 'text') {
    const textMsg = msg as any; // Cast specifically if needed
    const content = textMsg.Content.trim();

    // Check for Image Generation Command (e.g., "画 A cat")
    if (content.startsWith('画') || content.toLowerCase().startsWith('generate')) {
       // Extract prompt
       const prompt = content.replace(/^(画|generate)\s*/i, '');
       if (!prompt) {
         replyContent = 'Please provide a description. Example: "画一只可爱的猫" (Draw a cute cat).';
       } else {
         replyContent = await AIService.generateImage(prompt);
       }
    } else {
      // Normal Chat
      replyContent = await AIService.chatWithAI(content);
    }

  } else if (MsgType === 'image') {
    // Handling Image-to-Image or just acknowledging images
    // Note: Implementing real Img2Img requires downloading the PicUrl and uploading multipart/form-data to AI
    // For now, we return a simple response or description.
    replyContent = 'Received your image. Image-to-image features are coming soon!';
  } else {
    replyContent = 'Unsupported message type.';
  }

  // Construct XML
  return buildTextResponse(FromUserName, ToUserName, replyContent);
};
