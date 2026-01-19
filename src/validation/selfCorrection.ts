/**
 * Self-Correction Loop - Automatically fixes LLM output when it fails validation
 */

import { ZodSchema } from "zod";
import {
  validateResponse,
  formatErrorsForCorrection,
  ValidationError,
} from "./schemaValidator";

export interface CorrectionConfig {
  maxRetries: number;
  onRetry?: (attempt: number, errors: ValidationError[]) => void;
}

export interface AttemptRecord {
  response: string;
  errors: ValidationError[];
  prompt: string;
}

export interface CorrectionResult<T> {
  success: boolean;
  data: T | null;
  attempts: number;
  history: AttemptRecord[];
}

const DEFAULT_CONFIG: CorrectionConfig = {
  maxRetries: 3,
  onRetry: () => {},
};

/**
 * Builds a correction prompt that instructs the LLM to fix its previous output
 */
export function buildCorrectionPrompt(
  originalPrompt: string,
  invalidResponse: string,
  errors: ValidationError[]
): string {
  const errorDetails = formatErrorsForCorrection(errors);

  return `Your previous response was invalid JSON or did not match the required schema.

PREVIOUS RESPONSE:
${invalidResponse.slice(0, 500)}${invalidResponse.length > 500 ? "..." : ""}

VALIDATION ERRORS:
${errorDetails}

Please fix your response. Output ONLY valid JSON that matches the schema.
Do not include any explanation or markdown formatting.
Just output the corrected JSON.

ORIGINAL REQUEST:
${originalPrompt}`;
}

export interface ExecuteWithCorrectionParams<T> {
  prompt: string;
  schema: ZodSchema<T>;
  inference: (prompt: string) => Promise<string>;
  config?: Partial<CorrectionConfig>;
}

/**
 * Attempts to get valid output from an LLM, with automatic self-correction on failure
 */
export async function executeWithCorrection<T>({
  prompt,
  schema,
  inference,
  config = {},
}: ExecuteWithCorrectionParams<T>): Promise<CorrectionResult<T>> {
  const settings: CorrectionConfig = { ...DEFAULT_CONFIG, ...config };
  const history: AttemptRecord[] = [];
  let attempts = 0;
  let currentPrompt = prompt;

  while (attempts < settings.maxRetries) {
    attempts++;

    // Call the LLM
    const response = await inference(currentPrompt);

    // Validate the response
    const validation = validateResponse(response, schema);

    // Record this attempt
    history.push({
      response,
      errors: validation.errors,
      prompt: currentPrompt,
    });

    // If valid, we're done!
    if (validation.success) {
      return {
        success: true,
        data: validation.data,
        attempts,
        history,
      };
    }

    // If this was the last attempt, fail
    if (attempts >= settings.maxRetries) {
      break;
    }

    // Build correction prompt for next attempt
    settings.onRetry?.(attempts, validation.errors);
    currentPrompt = buildCorrectionPrompt(prompt, response, validation.errors);
  }

  // All retries exhausted
  return {
    success: false,
    data: null,
    attempts,
    history,
  };
}

/**
 * Creates a correction executor with pre-configured settings
 */
export function createCorrectionExecutor(
  defaultConfig: Partial<CorrectionConfig> = {}
) {
  return <T>(params: ExecuteWithCorrectionParams<T>) =>
    executeWithCorrection({
      ...params,
      config: { ...defaultConfig, ...params.config },
    });
}
