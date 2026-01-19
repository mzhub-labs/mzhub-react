/**
 * Cerebras Provider - Wafer-scale AI inference using official SDK
 *
 * Uses the official @cerebras/cerebras_cloud_sdk package.
 * Supports: llama3.1-8b, llama3.1-70b
 *
 * @requires @cerebras/cerebras_cloud_sdk - npm install @cerebras/cerebras_cloud_sdk
 */

import { AIProvider, InferenceOptions, InferenceResponse } from "./openai";

export interface CerebrasConfig {
  /** Cerebras API key (defaults to CEREBRAS_API_KEY env var) */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Default inference options */
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
  };
}

const DEFAULT_MODEL = "llama3.1-8b";

// Type for the Cerebras SDK client
interface CerebrasClient {
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
 * Dynamically imports the Cerebras SDK
 * This allows the library to work even if the SDK isn't installed
 */
async function getCerebrasClient(apiKey?: string): Promise<CerebrasClient> {
  try {
    const moduleName = "@cerebras/cerebras_cloud_sdk";
    const CerebrasModule = await import(/* @vite-ignore */ moduleName);
    const Cerebras = CerebrasModule.default || CerebrasModule;
    return new Cerebras({ apiKey }) as unknown as CerebrasClient;
  } catch (error) {
    throw new Error(
      "@cerebras/cerebras_cloud_sdk is not installed. Run: npm install @cerebras/cerebras_cloud_sdk"
    );
  }
}

/**
 * Creates a Cerebras provider using the official SDK
 *
 * @example
 * ```ts
 * import { createCerebrasProvider } from '@mzhub/react';
 *
 * const cerebras = createCerebrasProvider({
 *   apiKey: process.env.CEREBRAS_API_KEY,
 *   model: 'llama3.1-70b'
 * });
 *
 * const response = await cerebras.inference('Why is fast inference important?');
 * ```
 */
export function createCerebrasProvider(
  config: CerebrasConfig = {}
): AIProvider {
  const model = config.model || DEFAULT_MODEL;
  let clientPromise: Promise<CerebrasClient> | null = null;

  function getClient(): Promise<CerebrasClient> {
    if (!clientPromise) {
      clientPromise = getCerebrasClient(config.apiKey);
    }
    return clientPromise;
  }

  return {
    name: "cerebras",

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

    // Note: Cerebras SDK supports streaming via SSE
    // For simplicity, we simulate streaming here
    async *streamInference(
      prompt: string,
      options: InferenceOptions = {}
    ): AsyncIterable<string> {
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
