import dotenv from 'dotenv';

dotenv.config();

export const CONFIG = {
  // WeChat Configuration (Set these in your WeChat Admin Console)
  PORT: process.env.PORT || 7999, // WeChat usually requires port 80 or 443
  WECHAT_TOKEN: 'token123456aitoken', // Must match the token in WeChat Admin

  // AI Service Configuration
  AI_API_BASE: 'http://124.220.154.147:8000',
  AI_API_KEY: '6fe6a33671d1b548f1c9c2e8f4e8a617', // Replace with your actual key

  // Timeout to prevent WeChat from reporting service unavailable (WeChat waits max 30s)
  TIMEOUT_MS: 30000,

  // Optional: For sending native Image messages (requires Service Account or Test Account)
  WECHAT_APPID: 'wx73fa5e07886d03e9',
  WECHAT_APPSECRET: '60337e410bccac9b45888b5ef13c3543'
};