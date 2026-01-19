/**
 * useInference - Simple inference hook for one-off AI tasks
 *
 * Like React Query but for AI inference. Simpler than useSemanticState
 * when you just need to run a prompt and get a result.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { ZodSchema } from "zod";
import { useSynapseContext } from "../context";
import { buildInferencePrompt } from "../compiler";
import { validateResponse } from "../validation";

export interface UseInferenceOptions<T = string> {
  /** The task/prompt to run */
  task: string;
  /** Input data to process */
  input: string;
  /** Optional Zod schema for structured output */
  schema?: ZodSchema<T>;
  /** Run immediately on mount */
  immediate?: boolean;
  /** Cache key (same key = cached result) */
  cacheKey?: string;
  /** Refetch when input changes */
  refetchOnInputChange?: boolean;
}

export interface UseInferenceResult<T> {
  /** The inference result */
  data: T | null;
  /** Loading state */
  loading: boolean;
  /** Error if inference failed */
  error: Error | null;
  /** Manually trigger inference */
  refetch: () => Promise<T | null>;
  /** Clear the result */
  clear: () => void;
}

// Simple in-memory cache
const inferenceCache = new Map<string, unknown>();

export function useInference<T = string>(
  options: UseInferenceOptions<T>
): UseInferenceResult<T> {
  const {
    task,
    input,
    schema,
    immediate = true,
    cacheKey,
    refetchOnInputChange = true,
  } = options;

  const synapse = useSynapseContext();

  const [data, setData] = useState<T | null>(() => {
    if (cacheKey && inferenceCache.has(cacheKey)) {
      return inferenceCache.get(cacheKey) as T;
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const prevInputRef = useRef(input);
  const hasFetchedRef = useRef(false);

  const fetchData = useCallback(async (): Promise<T | null> => {
    // Check cache first
    if (cacheKey && inferenceCache.has(cacheKey)) {
      const cached = inferenceCache.get(cacheKey) as T;
      setData(cached);
      return cached;
    }

    setLoading(true);
    setError(null);

    try {
      const prompt = buildInferencePrompt({
        task,
        input,
        outputFormat: schema ? "JSON" : "text",
      });

      synapse.log("Inference:", task);
      const response = await synapse.provider.inference(prompt);

      let result: T;

      if (schema) {
        const validation = validateResponse(response.content, schema);
        if (!validation.success) {
          throw new Error(
            `Validation failed: ${validation.errors
              .map((e) => e.message)
              .join(", ")}`
          );
        }
        result = validation.data as T;
      } else {
        result = response.content as T;
      }

      // Cache if key provided
      if (cacheKey) {
        inferenceCache.set(cacheKey, result);
      }

      setData(result);
      setLoading(false);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setLoading(false);
      synapse.log("Inference error:", error);
      return null;
    }
  }, [task, input, schema, cacheKey, synapse]);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
    if (cacheKey) {
      inferenceCache.delete(cacheKey);
    }
  }, [cacheKey]);

  // Initial fetch
  useEffect(() => {
    if (immediate && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchData();
    }
  }, [immediate, fetchData]);

  // Refetch on input change
  useEffect(() => {
    if (
      refetchOnInputChange &&
      prevInputRef.current !== input &&
      hasFetchedRef.current
    ) {
      prevInputRef.current = input;
      fetchData();
    }
  }, [input, refetchOnInputChange, fetchData]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
    clear,
  };
}

/**
 * Clear all cached inference results
 */
export function clearInferenceCache() {
  inferenceCache.clear();
}
