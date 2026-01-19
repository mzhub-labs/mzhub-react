/**
 * Synapse Error - Structured errors with actionable suggestions
 */

export type SynapseErrorCode =
  | "VALIDATION_FAILED"
  | "INFERENCE_TIMEOUT"
  | "MODEL_ERROR"
  | "NETWORK_ERROR"
  | "CAPABILITY_UNSUPPORTED"
  | "MEMORY_PRESSURE"
  | "SECURITY_VIOLATION";

export interface SynapseErrorDebugInfo {
  prompt?: string;
  response?: string;
  validationErrors?: unknown[];
  modelId?: string;
  timestamp: number;
}

export class SynapseError extends Error {
  readonly code: SynapseErrorCode;
  readonly suggestion: string;
  readonly debugInfo: SynapseErrorDebugInfo;
  readonly recoverable: boolean;
  readonly originalCause?: Error;

  constructor(
    code: SynapseErrorCode,
    message: string,
    options: {
      suggestion?: string;
      debugInfo?: Partial<SynapseErrorDebugInfo>;
      recoverable?: boolean;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = "SynapseError";
    this.code = code;
    this.suggestion = options.suggestion || this.getDefaultSuggestion(code);
    this.debugInfo = {
      timestamp: Date.now(),
      ...options.debugInfo,
    };
    this.recoverable = options.recoverable ?? this.isRecoverableByDefault(code);

    if (options.cause) {
      this.originalCause = options.cause;
    }
  }

  private getDefaultSuggestion(code: SynapseErrorCode): string {
    switch (code) {
      case "VALIDATION_FAILED":
        return "Try simplifying your intent or check your schema definition.";
      case "INFERENCE_TIMEOUT":
        return "The AI is taking too long. Try a shorter prompt or switch to cloud mode.";
      case "MODEL_ERROR":
        return "The local model encountered an error. Synapse will fallback to cloud.";
      case "NETWORK_ERROR":
        return "Check your internet connection or API key configuration.";
      case "CAPABILITY_UNSUPPORTED":
        return "Your device does not support local AI. Cloud mode will be used.";
      case "MEMORY_PRESSURE":
        return "Close some browser tabs or switch to cloud mode.";
      case "SECURITY_VIOLATION":
        return "The intent was blocked for security reasons.";
      default:
        return "An unexpected error occurred.";
    }
  }

  private isRecoverableByDefault(code: SynapseErrorCode): boolean {
    switch (code) {
      case "CAPABILITY_UNSUPPORTED":
      case "MODEL_ERROR":
      case "MEMORY_PRESSURE":
        return true; // Can fallback to cloud
      case "VALIDATION_FAILED":
      case "INFERENCE_TIMEOUT":
        return true; // Can retry
      case "SECURITY_VIOLATION":
      case "NETWORK_ERROR":
        return false;
      default:
        return false;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      debugInfo: this.debugInfo,
    };
  }
}

/**
 * Error factory functions for common scenarios
 */
export const Errors = {
  validationFailed: (response: string, errors: unknown[]) =>
    new SynapseError(
      "VALIDATION_FAILED",
      "AI returned invalid data after all retries",
      {
        debugInfo: { response, validationErrors: errors },
      }
    ),

  inferenceTimeout: (modelId: string, timeoutMs: number) =>
    new SynapseError(
      "INFERENCE_TIMEOUT",
      `Inference timed out after ${timeoutMs}ms`,
      {
        debugInfo: { modelId },
      }
    ),

  modelError: (modelId: string, cause: Error) =>
    new SynapseError(
      "MODEL_ERROR",
      `Model "${modelId}" failed: ${cause.message}`,
      {
        debugInfo: { modelId },
        cause,
      }
    ),

  networkError: (cause: Error) =>
    new SynapseError(
      "NETWORK_ERROR",
      `Network request failed: ${cause.message}`,
      {
        cause,
      }
    ),

  capabilityUnsupported: (missing: string[]) =>
    new SynapseError(
      "CAPABILITY_UNSUPPORTED",
      `Required capabilities not available: ${missing.join(", ")}`
    ),

  memoryPressure: (usedMB: number, limitMB: number) =>
    new SynapseError(
      "MEMORY_PRESSURE",
      `Memory usage (${usedMB}MB) approaching limit (${limitMB}MB)`
    ),

  securityViolation: (reason: string, intent: string) =>
    new SynapseError("SECURITY_VIOLATION", `Blocked: ${reason}`, {
      suggestion: "Rephrase your intent without sensitive instructions.",
      debugInfo: { prompt: intent },
      recoverable: false,
    }),
};
