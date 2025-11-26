export interface WeChatConfig {
  token: string;
  appid?: string;
  appsecret?: string;
}

export interface WeChatTextMessage {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: 'text';
  Content: string;
  MsgId: string;
}

export interface WeChatImageMessage {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: 'image';
  PicUrl: string;
  MediaId: string;
  MsgId: string;
}

export type WeChatReceivedMessage = WeChatTextMessage | WeChatImageMessage;

export interface AIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface AIImageResponse {
  data: Array<{
    url: string;
  }>;
}

export interface WeChatReply {
  type: 'text' | 'image';
  content?: string;
  mediaId?: string;
}
