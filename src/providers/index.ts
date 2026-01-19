// ============================================
// Provider Types & Interfaces
// ============================================
export {
  type AIProvider,
  type InferenceOptions,
  type InferenceResponse,
  createOpenAIProvider,
  createMockProvider,
  type OpenAIConfig,
} from "./openai";

export {
  type ProviderType,
  type ProviderConfig,
  type CloudProviderConfig,
  type ChatMessage,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  fetchChatCompletion,
  streamChatCompletion,
} from "./base";

// ============================================
// Cloud Providers
// ============================================
export { createAnthropicProvider, type AnthropicConfig } from "./anthropic";

export { createGeminiProvider, type GeminiConfig } from "./gemini";

export { createGroqProvider, type GroqConfig } from "./groq";

export { createCerebrasProvider, type CerebrasConfig } from "./cerebras";

// ============================================
// Local Provider (Transformers.js)
// ============================================
export {
  createTransformersProvider,
  preloadModel,
  clearPipelineCache,
  type TransformersConfig,
  type TransformersTask,
} from "./transformers";

// ============================================
// Hybrid Provider (Cloud + Local)
// ============================================
export {
  createHybridProvider,
  type HybridProviderConfig,
  type HybridProviderStatus,
  type InferenceMode,
  type DownloadProgress,
} from "./hybrid";

// ============================================
// Provider Factory (Extensible)
// ============================================
export {
  createProvider,
  registerProvider,
  getAvailableProviders,
  isProviderAvailable,
} from "./factory";
