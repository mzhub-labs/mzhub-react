/**
 * Groq Provider - Ultra-fast inference using official SDK
 *
 * Uses the official groq-sdk package for type-safe API access.
 * Supports: llama-3.1-70b-versatile, mixtral-8x7b-32768, etc.
 *
 * @requires groq-sdk - npm install groq-sdk
 */

import { AIProvider, InferenceOptions, InferenceResponse } from "./openai";

export interface GroqConfig {
  /** Groq API key (defaults to GROQ_API_KEY env var) */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Default inference options */
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
  };
}

const DEFAULT_MODEL = "llama-3.1-8b-instant";

// Type for the Groq SDK client
interface GroqClient {
  chat: {
    completions: {
      create: (params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
        stream?: boolean;
      }) => Promise<{
        id: string;
        choices: Array<{
          message: { role: string; content: string };
          finish_reason: string;
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
      }>;
    };
  };
}

/**
 * Dynamically imports the groq-sdk
 * This allows the library to work even if groq-sdk isn't installed
 */
async function getGroqClient(apiKey?: string): Promise<GroqClient> {
  try {
    const moduleName = "groq-sdk";
    const GroqModule = await import(/* @vite-ignore */ moduleName);
    const Groq = GroqModule.default || GroqModule;
    return new Groq({ apiKey }) as unknown as GroqClient;
  } catch (error) {
    throw new Error("groq-sdk is not installed. Run: npm install groq-sdk");
  }
}

/**
 * Creates a Groq provider using the official SDK
 *
 * @example
 * ```ts
 * import { createGroqProvider } from '@mzhub/react';
 *
 * const groq = createGroqProvider({
 *   apiKey: process.env.GROQ_API_KEY,
 *   model: 'llama-3.1-70b-versatile'
 * });
 *
 * const response = await groq.inference('Explain quantum computing');
 * ```
 */
export function createGroqProvider(config: GroqConfig = {}): AIProvider {
  const model = config.model || DEFAULT_MODEL;
  let clientPromise: Promise<GroqClient> | null = null;

  function getClient(): Promise<GroqClient> {
    if (!clientPromise) {
      clientPromise = getGroqClient(config.apiKey);
    }
    return clientPromise;
  }

  return {
    name: "groq",

    async inference(
      prompt: string,
      options: InferenceOptions = {}
    ): Promise<InferenceResponse> {
      const client = await getClient();
      const mergedOptions = { ...config.defaultOptions, ...options };

      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: mergedOptions.temperature ?? 0.7,
        max_tokens: mergedOptions.maxTokens ?? 2048,
      });

      const choice = completion.choices[0];

      return {
        content: choice.message.content,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
        finishReason: choice.finish_reason,
      };
    },

    // Note: For streaming, you would need to use client.chat.completions.create with stream: true
    // The SDK returns an async iterator for streaming
    async *streamInference(
      prompt: string,
      options: InferenceOptions = {}
    ): AsyncIterable<string> {
      // For now, we fall back to non-streaming and yield the full response
      // Full streaming support requires handling the SDK's stream response
      const response = await this.inference(prompt, options);

      // Simulate streaming by yielding words
      const words = response.content.split(" ");
      for (let i = 0; i < words.length; i++) {
        yield words[i] + (i < words.length - 1 ? " " : "");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}
