import crypto from 'crypto';
import axios from 'axios';
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
 * Generates the XML response for WeChat Image
 */
export const buildImageResponse = (toUser: string, fromUser: string, mediaId: string): string => {
  const obj = {
    ToUserName: toUser,
    FromUserName: fromUser,
    CreateTime: Math.floor(Date.now() / 1000),
    MsgType: 'image',
    Image: {
      MediaId: mediaId
    }
  };
  return builder.buildObject(obj);
};

// Access Token Cache (Simple In-Memory)
let accessToken: string = '';
let tokenExpiresAt: number = 0;

const getAccessToken = async (): Promise<string> => {
  if (!CONFIG.WECHAT_APPID || !CONFIG.WECHAT_APPSECRET) return '';
  if (Date.now() < tokenExpiresAt) return accessToken;

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${CONFIG.WECHAT_APPID}&secret=${CONFIG.WECHAT_APPSECRET}`;
    const res = await axios.get(url);
    if (res.data.access_token) {
      accessToken = res.data.access_token;
      tokenExpiresAt = Date.now() + (res.data.expires_in - 200) * 1000;
      return accessToken;
    }
  } catch (e) {
    console.error('Failed to get Access Token', e);
  }
  return '';
};

const uploadTempMedia = async (imageUrl: string): Promise<string> => {
  // Placeholder: Requires 'form-data' and valid AppID/Secret
  // If you have AppID, implement the upload logic here to get MediaId
  const token = await getAccessToken();
  if (!token) return '';

  // Logic to download image and upload to https://api.weixin.qq.com/cgi-bin/media/upload?access_token=ACCESS_TOKEN&type=image
  // Return media_id
  return '';
};

/**
 * Main Logic to handle the message content
 */
export const processMessage = async (msg: WeChatReceivedMessage): Promise<string> => {
  const { FromUserName, ToUserName, MsgType } = msg;

  let replyContent = '';
  let mediaId = '';

  if (MsgType === 'text') {
    const textMsg = msg as any;
    const content = textMsg.Content.trim();

    // Check for explicit Image Generation Command if needed, 
    // but we prefer the Chat endpoint's natural ability.
    // However, if the user explicitly says "generate image of...", we can still pass it to chat.

    replyContent = await AIService.chatWithAI(content);

  } else if (MsgType === 'image') {
    // Handling Image-to-Image
    const imgMsg = msg as any;
    const picUrl = imgMsg.PicUrl;
    // Send image to AI for analysis/modification
    replyContent = await AIService.chatWithAI('请分析这张图片', picUrl);
  } else {
    replyContent = 'Unsupported message type.';
  }

  // Post-processing: Check for Markdown Images in the response
  // Example: ![image](https://...)
  const imgMatch = replyContent.match(/!\[.*?\]\((.*?)\)/);
  if (imgMatch) {
    const imgUrl = imgMatch[1];
    // Try to upload to WeChat to send as native Image
    mediaId = await uploadTempMedia(imgUrl);

    if (!mediaId) {
      // Fallback: Format the text nicely
      // Remove the markdown syntax and present a clean link
      replyContent = replyContent.replace(/!\[(.*?)\]\((.*?)\)/g, '\n【图片】$1: $2\n');
      // Also clean up the "Original Image" text if it's redundant or messy
      replyContent = replyContent.replace(/原图:\s*https?:\/\/.*?\n?/g, ''); // Optional cleanup
    }
  }

  // Construct XML
  if (mediaId) {
    return buildImageResponse(FromUserName, ToUserName, mediaId);
  } else {
    return buildTextResponse(FromUserName, ToUserName, replyContent);
  }
};
