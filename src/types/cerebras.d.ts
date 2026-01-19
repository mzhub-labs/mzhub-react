/**
 * Type declarations for @cerebras/cerebras_cloud_sdk
 */

declare module "@cerebras/cerebras_cloud_sdk" {
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
    time_info?: {
      queue_time: number;
      prompt_time: number;
      completion_time: number;
      total_time: number;
    };
  }

  export interface TextCompletionParams {
    model: string;
    prompt: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
  }

  export interface TextCompletion {
    id: string;
    choices: Array<{
      text: string;
      finish_reason: string;
    }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }

  export interface CerebrasConfig {
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

  export class Completions {
    create(params: TextCompletionParams): Promise<TextCompletion>;
  }

  export default class Cerebras {
    constructor(config?: CerebrasConfig);
    chat: Chat;
    completions: Completions;
  }
}
