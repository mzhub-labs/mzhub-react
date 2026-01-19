import { AIProvider, InferenceOptions, InferenceResponse } from "./openai";
import { CloudProviderConfig } from "./base";

export interface AnthropicConfig extends CloudProviderConfig {
  /** Anthropic API version */
  apiVersion?: string;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-3-haiku-20240307";
const DEFAULT_API_VERSION = "2023-06-01";

export function createAnthropicProvider(config: AnthropicConfig): AIProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const apiVersion = config.apiVersion || DEFAULT_API_VERSION;

  return {
    name: "anthropic",

    async inference(
      prompt: string,
      options: InferenceOptions = {}
    ): Promise<InferenceResponse> {
      const mergedOptions = { ...config.defaultOptions, ...options };

      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": apiVersion,
        },
        body: JSON.stringify({
          model,
          max_tokens: mergedOptions.maxTokens ?? 2048,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
      }

      const data = await response.json();

      return {
        content: data.content[0]?.text || "",
        usage: data.usage
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
              totalTokens: data.usage.input_tokens + data.usage.output_tokens,
            }
          : undefined,
        finishReason: data.stop_reason,
      };
    },

    async *streamInference(
      prompt: string,
      options: InferenceOptions = {}
    ): AsyncIterable<string> {
      const mergedOptions = { ...config.defaultOptions, ...options };

      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": apiVersion,
        },
        body: JSON.stringify({
          model,
          max_tokens: mergedOptions.maxTokens ?? 2048,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} - ${error}`);
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
              if (parsed.type === "content_block_delta") {
                const text = parsed.delta?.text;
                if (text) yield text;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    },
  };
}
