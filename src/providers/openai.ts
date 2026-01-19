/**
 * AI Provider Interface - Abstraction for different LLM backends
 */

export interface InferenceOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface InferenceResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

export interface AIProvider {
  name: string;
  inference(
    prompt: string,
    options?: InferenceOptions
  ): Promise<InferenceResponse>;
  streamInference?(
    prompt: string,
    options?: InferenceOptions
  ): AsyncIterable<string>;
}

/**
 * OpenAI-compatible provider
 */
export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  defaultOptions?: InferenceOptions;
}

export function createOpenAIProvider(config: OpenAIConfig): AIProvider {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const model = config.model || "gpt-4o-mini";

  return {
    name: "openai",

    async inference(
      prompt: string,
      options: InferenceOptions = {}
    ): Promise<InferenceResponse> {
      const mergedOptions = { ...config.defaultOptions, ...options };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: mergedOptions.temperature ?? 0.7,
          max_tokens: mergedOptions.maxTokens ?? 2048,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const choice = data.choices[0];

      return {
        content: choice.message.content,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        finishReason: choice.finish_reason,
      };
    },

    async *streamInference(
      prompt: string,
      options: InferenceOptions = {}
    ): AsyncIterable<string> {
      const mergedOptions = { ...config.defaultOptions, ...options };

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: mergedOptions.temperature ?? 0.7,
          max_tokens: mergedOptions.maxTokens ?? 2048,
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${error}`);
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
            const data = line.slice(6);
            if (data === "[DONE]") return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              if (content) yield content;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    },
  };
}

/**
 * Mock provider for testing
 */
export function createMockProvider(
  responses: Record<string, string>
): AIProvider {
  return {
    name: "mock",
    async inference(prompt: string): Promise<InferenceResponse> {
      // Find a matching response based on prompt keywords
      for (const [key, value] of Object.entries(responses)) {
        if (prompt.toLowerCase().includes(key.toLowerCase())) {
          return { content: value };
        }
      }
      return { content: responses["default"] || "{}" };
    },
  };
}
