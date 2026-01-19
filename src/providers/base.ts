/**
 * Provider Base - Scalable provider architecture
 *
 * All providers implement the AIProvider interface.
 * New providers can be added by creating a factory function.
 */

// Re-export the core interface
export {
  type AIProvider,
  type InferenceOptions,
  type InferenceResponse,
} from "./openai";

/**
 * Provider registry for dynamic provider creation
 */
export type ProviderType =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "cerebras"
  | "transformers"
  | "mock";

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  [key: string]: unknown;
}

/**
 * Common configuration shared by all cloud providers
 */
export interface CloudProviderConfig {
  /** API key for authentication */
  apiKey: string;
  /** Custom base URL (optional) */
  baseUrl?: string;
  /** Model to use */
  model?: string;
  /** Default inference options */
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Request/response format for chat completions
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
    index: number;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Helper to create a provider from a fetch-based API
 */
export async function fetchChatCompletion(
  url: string,
  headers: Record<string, string>,
  body: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Helper for streaming chat completions (SSE format)
 */
export async function* streamChatCompletion(
  url: string,
  headers: Record<string, string>,
  body: ChatCompletionRequest
): AsyncIterable<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") return;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}
