/**
 * Type declarations for groq-sdk
 */

declare module "groq-sdk" {
  export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
  }

  export interface ChatCompletionParams {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    top_p?: number;
    stop?: string | string[];
  }

  export interface ChatCompletion {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
      index: number;
      message: ChatMessage;
      finish_reason: string;
    }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }

  export interface GroqConfig {
    apiKey?: string;
    baseURL?: string;
    timeout?: number;
    maxRetries?: number;
  }

  export class Chat {
    completions: {
      create(params: ChatCompletionParams): Promise<ChatCompletion>;
    };
  }

  export default class Groq {
    constructor(config?: GroqConfig);
    chat: Chat;
  }
}
