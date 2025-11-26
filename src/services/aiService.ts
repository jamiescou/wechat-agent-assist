import axios from 'axios';
import { CONFIG } from '../config';
import { AIChatResponse, AIImageResponse } from '../types';

const aiClient = axios.create({
  baseURL: CONFIG.AI_API_BASE,
  headers: {
    'Authorization': `Bearer ${CONFIG.AI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // Long timeout for AI generation, though WeChat might timeout sooner
});

/**
 * Sends a chat message to the AI service.
 */
export const chatWithAI = async (userMessage: string): Promise<string> => {
  try {
    const response = await aiClient.post<AIChatResponse>('/v1/chat/completions', {
      model: 'doubao', // Using 'default' or a common model name like 'gpt-3.5-turbo'
      messages: [
        { role: 'system', content: 'You are a helpful assistant serving a WeChat Official Account.' },
        { role: 'user', content: userMessage }
      ],
      stream: false
    });
	console.log('userMessage==', userMessage, response.data.choices[0].message)
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content;
    }
    return 'Error: AI returned an empty response.';
  } catch (error: any) {
    console.error('AI Chat Error:', error.message);
    return 'Sorry, I encountered an error communicating with the AI service.';
  }
};

/**
 * Generates an image based on the prompt.
 */
export const generateImage = async (prompt: string): Promise<string> => {
  try {
    const response = await aiClient.post<AIImageResponse>('/v1/images/generations', {
      model: "Seedream 4.0",
      prompt: prompt,
      n: 1,
      ratio: "1:1",
      stream: false
    });
    if (response.data && response.data.data && response.data.data.length > 0) {
      // Return the URL. Note: WeChat needs MediaID for native image display, 
      // but sending the link is the most robust method without implementing the complex Media Upload API.
      return `Image Generated:\n${response.data.data[0].url}`;
    }
    return 'Error: AI failed to generate image.';
  } catch (error: any) {
    console.error('AI Image Error:', error.message);
    return 'Sorry, image generation failed. Please try again later.';
  }
};
