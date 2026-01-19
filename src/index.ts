
export {
  useSemanticState,
  useInference,
  clearInferenceCache,
  // SSR-safe versions
  useSSRSemanticState,
  useSSRInference,
  useIsServer,
  useHydrated,
  type SemanticStateConfig,
  type SemanticStateMetadata,
  type DispatchFn,
  type UseSemanticStateReturn,
  type UseInferenceOptions,
  type UseInferenceResult,
  type SSRSemanticStateConfig,
  type SSRSemanticStateReturn,
  type SSRInferenceConfig,
  type SSRInferenceReturn,
} from "./hooks";

// ============================================
// Declarative Components
// ============================================
export {
  Infer,
  clearInferCache,
  primeInferCache,
  StreamingText,
  useStreamingText,
  ConfidenceGate,
  useConfidenceGate,
  type InferProps,
  type InferRenderProps,
  type StreamingTextProps,
  type ConfidenceGateProps,
  type ConfirmationRenderProps,
} from "./components";

// ============================================
// Context/Provider
// ============================================
export {
  SynapseProvider,
  useSynapseContext,
  useSynapseConfig,
  type SynapseConfig,
  type SynapseProviderProps,
} from "./context";

// ============================================
// AI Providers (Scalable Architecture)
// ============================================
export {
  // Factory (recommended for dynamic creation)
  createProvider,
  registerProvider,
  getAvailableProviders,
  isProviderAvailable,
  // Core types
  type AIProvider,
  type InferenceOptions,
  type InferenceResponse,
  type ProviderType,
  type ProviderConfig,
  type CloudProviderConfig,
  // OpenAI-compatible
  createOpenAIProvider,
  createMockProvider,
  type OpenAIConfig,
  // Anthropic (Claude)
  createAnthropicProvider,
  type AnthropicConfig,
  // Google Gemini
  createGeminiProvider,
  type GeminiConfig,
  // Groq (fast inference)
  createGroqProvider,
  type GroqConfig,
  // Cerebras (wafer-scale)
  createCerebrasProvider,
  type CerebrasConfig,
  // Local (Transformers.js)
  createTransformersProvider,
  preloadModel,
  clearPipelineCache,
  type TransformersConfig,
  type TransformersTask,
  // Hybrid (cloud + local)
  createHybridProvider,
  type HybridProviderConfig,
  type HybridProviderStatus,
  type InferenceMode,
} from "./providers";

// ============================================
// Validation & Security (Firewall)
// ============================================
export {
  validateResponse,
  extractJson,
  executeWithCorrection,
  RollbackManager,
  createRollbackManager,
  type ValidationResult,
  type ValidationError,
  type CorrectionResult,
  type StateSnapshot,
} from "./validation";

export {
  // Prompt Guard (injection prevention)
  PromptGuard,
  createPromptGuard,
  quickSafetyCheck,
  type PromptGuardConfig,
  type SecurityViolation,
  // Output Sanitizer (XSS prevention)
  sanitizeOutput,
  escapeHtml,
  validateSafeContent,
  createSafeRenderer,
  type SanitizerConfig,
  // API Key Protection
  validateNotApiKey,
  createSecureInference,
  SECURITY_DISCLAIMER,
  type ProxyConfig,
  type SecureProviderConfig,
} from "./security";

// ============================================
// Errors
// ============================================
export {
  SynapseError,
  Errors,
  type SynapseErrorCode,
  type SynapseErrorDebugInfo,
} from "./errors";

// ============================================
// Runtime (Advanced Usage)
// ============================================
export {
  // Capability detection
  checkCapabilities,
  runSanityTest,
  estimateAvailableMemory,
  type CapabilityResult,
  // Model management
  fetchManifest,
  validateCachedModel,
  invalidateCache,
  listCachedModels,
  type ModelManifest,
  type CachedModelInfo,
  type ManifestValidation,
  // Worker bridge
  WorkerBridge,
  createWorkerBridge,
  // Download manager
  DownloadManager,
  createDownloadManager,
  type DownloadProgress as RuntimeDownloadProgress,
  // Memory manager (GDPR)
  clearAllMemory,
  getMemoryUsage,
  SynapseMemory,
  type MemorySources,
  // Context manager (token counting + compression)
  createContextManager,
  estimateTokens,
  countTokensDetailed,
  truncateContext,
  buildManagedPrompt,
  type ContextConfig,
  type ContextMessage,
  type ContextState,
} from "./runtime";

// ============================================
// Compiler Utilities (Advanced Usage)
// ============================================
export { buildPrompt, zodToDescription, type PromptConfig } from "./compiler";

// ============================================
// State Machine Types (Debugging/DevTools)
// ============================================
export { type MachineState, type StateContext, type AuditEntry } from "./utils";
