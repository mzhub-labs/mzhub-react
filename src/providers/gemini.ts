/**
 * Google Gemini Provider
 *
 * Supports: gemini-pro, gemini-1.5-pro, gemini-1.5-flash, etc.
 */

import { AIProvider, InferenceOptions, InferenceResponse } from "./openai";
import { CloudProviderConfig } from "./base";

export interface GeminiConfig extends CloudProviderConfig {
  /** Use v1beta for newer features */
  useBeta?: boolean;
}

const DEFAULT_MODEL = "gemini-1.5-flash";

export function createGeminiProvider(config: GeminiConfig): AIProvider {
  const model = config.model || DEFAULT_MODEL;
  const apiVersion = config.useBeta ? "v1beta" : "v1";
  const baseUrl =
    config.baseUrl ||
    `https://generativelanguage.googleapis.com/${apiVersion}/models`;

  return {
    name: "gemini",

    async inference(
      prompt: string,
      options: InferenceOptions = {}
    ): Promise<InferenceResponse> {
      const mergedOptions = { ...config.defaultOptions, ...options };

      const response = await fetch(
        `${baseUrl}/${model}:generateContent?key=${config.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: mergedOptions.temperature ?? 0.7,
              maxOutputTokens: mergedOptions.maxTokens ?? 2048,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];

      if (!candidate) {
        throw new Error("No response from Gemini");
      }

      const content = candidate.content?.parts?.[0]?.text || "";

      return {
        content,
        usage: data.usageMetadata
          ? {
              promptTokens: data.usageMetadata.promptTokenCount || 0,
              completionTokens: data.usageMetadata.candidatesTokenCount || 0,
              totalTokens: data.usageMetadata.totalTokenCount || 0,
            }
          : undefined,
        finishReason: candidate.finishReason,
      };
    },

    async *streamInference(
      prompt: string,
      options: InferenceOptions = {}
    ): AsyncIterable<string> {
      const mergedOptions = { ...config.defaultOptions, ...options };

      const response = await fetch(
        `${baseUrl}/${model}:streamGenerateContent?key=${config.apiKey}&alt=sse`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: mergedOptions.temperature ?? 0.7,
              maxOutputTokens: mergedOptions.maxTokens ?? 2048,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${error}`);
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

            try {
              const parsed = JSON.parse(data);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) yield text;
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    },
  };
}
