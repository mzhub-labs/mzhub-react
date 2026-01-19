/**
 * Provider Factory - Scalable provider creation
 *
 * Allows creating providers from configuration objects
 * and makes it easy to add new providers in the future.
 */

import { AIProvider } from "./openai";
import { ProviderType, ProviderConfig } from "./base";
import { createOpenAIProvider, createMockProvider } from "./openai";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";
import { createCerebrasProvider } from "./cerebras";
import { createTransformersProvider } from "./transformers";

// Registry of provider factories
// Using unknown -> unknown to allow flexibility, validation happens in each factory
type ProviderFactory = (config: unknown) => AIProvider;

const providerFactories: Record<ProviderType, ProviderFactory> = {
  openai: (config) =>
    createOpenAIProvider(config as Parameters<typeof createOpenAIProvider>[0]),
  anthropic: (config) =>
    createAnthropicProvider(
      config as Parameters<typeof createAnthropicProvider>[0]
    ),
  gemini: (config) =>
    createGeminiProvider(config as Parameters<typeof createGeminiProvider>[0]),
  groq: (config) =>
    createGroqProvider(config as Parameters<typeof createGroqProvider>[0]),
  cerebras: (config) =>
    createCerebrasProvider(
      config as Parameters<typeof createCerebrasProvider>[0]
    ),
  transformers: (config) =>
    createTransformersProvider(
      config as Parameters<typeof createTransformersProvider>[0]
    ),
  mock: (config) =>
    createMockProvider(
      (config as { responses?: Record<string, string> }).responses || {}
    ),
};

/**
 * Create a provider from a configuration object
 *
 * @example
 * ```ts
 * const provider = createProvider({
 *   type: 'anthropic',
 *   apiKey: 'sk-ant-...',
 *   model: 'claude-3-haiku-20240307'
 * });
 * ```
 */
export function createProvider(config: ProviderConfig): AIProvider {
  const factory = providerFactories[config.type];

  if (!factory) {
    throw new Error(
      `Unknown provider type: ${config.type}. ` +
        `Available: ${Object.keys(providerFactories).join(", ")}`
    );
  }

  return factory(config);
}

/**
 * Register a custom provider factory
 *
 * @example
 * ```ts
 * registerProvider('my-custom', (config) => ({
 *   name: 'my-custom',
 *   inference: async (prompt) => ({ content: '...' })
 * }));
 * ```
 */
export function registerProvider(type: string, factory: ProviderFactory): void {
  providerFactories[type as ProviderType] = factory;
}

/**
 * Get list of available provider types
 */
export function getAvailableProviders(): ProviderType[] {
  return Object.keys(providerFactories) as ProviderType[];
}

/**
 * Check if a provider type is registered
 */
export function isProviderAvailable(type: string): boolean {
  return type in providerFactories;
}
