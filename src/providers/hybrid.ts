/**
 * Hybrid Provider - Cloud-first with local fallback
 *
 * Addresses: 2GB Bounce Rate Wall pre-mortem risk
 *
 * Strategy:
 * 1. Cloud is always the default (instant, no download)
 * 2. Local model downloads in background while user works
 * 3. Once local is ready, simple tasks route to local
 * 4. Complex tasks always go to cloud
 */

import { AIProvider, InferenceOptions, InferenceResponse } from "./openai";
import {
  checkCapabilities,
  CapabilityResult,
} from "../runtime/capabilityCheck";
import { SynapseError, Errors } from "../errors";

export type InferenceMode = "cloud" | "local" | "hybrid";
export type TaskComplexity = "simple" | "medium" | "complex";

export interface HybridProviderConfig {
  /** Cloud provider (required - this is always available) */
  cloudProvider: AIProvider;
  /** Local provider (optional - created when model is ready) */
  localProvider?: AIProvider;
  /** Threshold for simple vs complex tasks (token estimate) */
  complexityThreshold?: number;
  /** Force a specific mode (overrides auto-detection) */
  forceMode?: InferenceMode;
  /** Called when local model becomes ready */
  onLocalReady?: () => void;
  /** Called with download progress */
  onDownloadProgress?: (progress: DownloadProgress) => void;
  /** Called when mode changes */
  onModeChange?: (mode: InferenceMode) => void;
}

export interface DownloadProgress {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  estimatedTimeRemaining: number | null;
}

export interface HybridProviderStatus {
  currentMode: InferenceMode;
  localAvailable: boolean;
  localDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  capabilities: CapabilityResult | null;
  lastInferenceMode: "cloud" | "local" | null;
  stats: {
    cloudCalls: number;
    localCalls: number;
    localSavings: number; // Estimated cost savings from local
  };
}

/**
 * Estimates task complexity based on prompt length and schema size
 */
function estimateComplexity(prompt: string, threshold: number): TaskComplexity {
  // Rough token estimate (1 token ≈ 4 chars)
  const estimatedTokens = Math.ceil(prompt.length / 4);

  if (estimatedTokens < threshold * 0.3) return "simple";
  if (estimatedTokens < threshold) return "medium";
  return "complex";
}

/**
 * Creates a hybrid provider that intelligently routes between cloud and local
 */
export function createHybridProvider(
  config: HybridProviderConfig
): AIProvider & {
  getStatus: () => HybridProviderStatus;
  setLocalProvider: (provider: AIProvider) => void;
  setMode: (mode: InferenceMode) => void;
} {
  const {
    cloudProvider,
    complexityThreshold = 2000,
    forceMode,
    onLocalReady,
    onModeChange,
  } = config;

  let localProvider: AIProvider | undefined = config.localProvider;
  let currentMode: InferenceMode = forceMode || "cloud";
  let capabilities: CapabilityResult | null = null;
  let downloadProgress: DownloadProgress | null = null;

  const stats = {
    cloudCalls: 0,
    localCalls: 0,
    localSavings: 0,
  };

  // Check capabilities on creation
  checkCapabilities().then((caps) => {
    capabilities = caps;
    if (!forceMode) {
      currentMode = caps.recommendedMode;
      onModeChange?.(currentMode);
    }
  });

  const provider: AIProvider & {
    getStatus: () => HybridProviderStatus;
    setLocalProvider: (provider: AIProvider) => void;
    setMode: (mode: InferenceMode) => void;
  } = {
    name: "hybrid",

    async inference(
      prompt: string,
      options?: InferenceOptions
    ): Promise<InferenceResponse> {
      const complexity = estimateComplexity(prompt, complexityThreshold);

      // Determine which provider to use
      let useLocal = false;

      if (currentMode === "local" && localProvider) {
        useLocal = true;
      } else if (currentMode === "hybrid" && localProvider) {
        // Only use local for simple/medium tasks
        useLocal = complexity !== "complex";
      }

      // Try local first if available
      if (useLocal && localProvider) {
        try {
          const startTime = Date.now();
          const result = await localProvider.inference(prompt, options);
          stats.localCalls++;
          stats.localSavings += estimateCost(prompt, result.content);
          return result;
        } catch (error) {
          // Fallback to cloud on local failure
          console.warn(
            "[Synapse] Local inference failed, falling back to cloud:",
            error
          );
        }
      }

      // Use cloud
      try {
        const result = await cloudProvider.inference(prompt, options);
        stats.cloudCalls++;
        return result;
      } catch (error) {
        throw Errors.networkError(error as Error);
      }
    },

    getStatus(): HybridProviderStatus {
      return {
        currentMode,
        localAvailable: !!localProvider,
        localDownloading: !!downloadProgress,
        downloadProgress,
        capabilities,
        lastInferenceMode:
          stats.localCalls > 0
            ? stats.localCalls > stats.cloudCalls
              ? "local"
              : "cloud"
            : null,
        stats: { ...stats },
      };
    },

    setLocalProvider(provider: AIProvider) {
      localProvider = provider;
      downloadProgress = null;
      onLocalReady?.();

      if (
        currentMode === "cloud" &&
        capabilities?.recommendedMode !== "cloud"
      ) {
        currentMode = "hybrid";
        onModeChange?.("hybrid");
      }
    },

    setMode(mode: InferenceMode) {
      if (mode === "local" && !localProvider) {
        console.warn(
          "[Synapse] Cannot set local mode: no local provider available"
        );
        return;
      }
      currentMode = mode;
      onModeChange?.(mode);
    },
  };

  return provider;
}

/**
 * Estimates the API cost of a prompt+response (in millicents)
 * Used to calculate savings from local inference
 */
function estimateCost(prompt: string, response: string): number {
  // Rough estimate based on GPT-4o-mini pricing
  // Input: $0.15 / 1M tokens, Output: $0.60 / 1M tokens
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(response.length / 4);

  const inputCost = (inputTokens / 1_000_000) * 0.15 * 1000; // millicents
  const outputCost = (outputTokens / 1_000_000) * 0.6 * 1000;

  return inputCost + outputCost;
}
