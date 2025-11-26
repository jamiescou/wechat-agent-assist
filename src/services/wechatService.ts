import crypto from 'crypto';
import axios from 'axios';
import xml2js from 'xml2js';
import { CONFIG } from '../config';
import { WeChatReceivedMessage, WeChatReply } from '../types';
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

export const replyToXml = (toUser: string, fromUser: string, reply: WeChatReply): string => {
  if (reply.type === 'image' && reply.mediaId) {
    return buildImageResponse(toUser, fromUser, reply.mediaId);
  }
  return buildTextResponse(toUser, fromUser, reply.content || '');
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
    console.error('WeChat Token Error:', res.data);
  } catch (e) {
    console.error('Failed to get Access Token', e);
  }
  return '';
};

const uploadTempMedia = async (imageUrl: string): Promise<string> => {
  if (!CONFIG.WECHAT_APPID || !CONFIG.WECHAT_APPSECRET) return '';
  const token = await getAccessToken();
  if (!token) return '';

  try {
    // 1. Download the image
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imageResponse.data, 'binary');

    // 2. Upload to WeChat
    // NOTE: In a real project, ensure 'form-data' is installed: npm install form-data
    // Here we will try to use it if available, or fail gracefully.
    const FormData = require('form-data');
    const form = new FormData();
    form.append('media', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

    const uploadUrl = `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`;
    const res = await axios.post(uploadUrl, form, {
      headers: form.getHeaders()
    });

    if (res.data.media_id) {
      return res.data.media_id;
    }
    console.error('WeChat Upload Error:', res.data);
  } catch (e: any) {
    console.error('Failed to upload media:', e.message);
  }
  return '';
};

/**
 * Sends a Custom Service Message (Kefu Message)
 * Used for async replies when the 5s timeout is exceeded.
 */
export const sendCustomMessage = async (toUser: string, reply: WeChatReply): Promise<void> => {
  const token = await getAccessToken();
  if (!token) return;

  const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`;

  let body: any = {
    touser: toUser,
    msgtype: reply.type
  };

  if (reply.type === 'text') {
    body.text = { content: reply.content };
  } else if (reply.type === 'image') {
    body.image = { media_id: reply.mediaId };
  }

  try {
    const res = await axios.post(url, body);
    console.log('Custom Message Sent:', res.data);
  } catch (e: any) {
    console.error('Failed to send Custom Message:', e.message);
  }
};

/**
 * Main Logic to handle the message content
 * Returns a structured reply object instead of XML string
 */
export const processMessage = async (msg: WeChatReceivedMessage): Promise<WeChatReply> => {
  const { MsgType } = msg;

  let replyContent = '';
  let mediaId = '';

  if (MsgType === 'text') {
    const textMsg = msg as any;
    const content = textMsg.Content.trim();

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
      replyContent = replyContent.replace(/!\[(.*?)\]\((.*?)\)/g, '\n【图片】$1: $2\n');
      replyContent = replyContent.replace(/原图:\s*https?:\/\/.*?\n?/g, '');
    }
  }

  // Construct Reply Object
  if (mediaId) {
    return { type: 'image', mediaId };
  } else {
    return { type: 'text', content: replyContent };
  }
};
