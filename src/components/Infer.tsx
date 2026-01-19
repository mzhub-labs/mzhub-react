/**
 * Infer Component - Declarative AI inference for React
 *
 * Security-first design:
 * - Output is sanitized by default
 * - Never renders raw HTML from AI
 * - Safe for SSR (deterministic skeleton)
 */

import React, {
  ReactNode,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { ZodSchema } from "zod";
import { useSynapseContext } from "../context";
import { buildInferencePrompt } from "../compiler";
import { validateResponse } from "../validation";
import { sanitizeOutput, escapeHtml } from "../security";

export interface InferProps<T = string> {
  /** The task/prompt to run */
  task: string;
  /** Input data to process */
  input: string;
  /** Optional Zod schema for structured output */
  schema?: ZodSchema<T>;
  /** Render function for the result */
  children: (result: InferRenderProps<T>) => ReactNode;
  /** Fallback content while loading (SSR-safe) */
  fallback?: ReactNode;
  /** Error fallback */
  errorFallback?: (error: Error) => ReactNode;
  /** Disable automatic sanitization (DANGEROUS - only for trusted output) */
  dangerouslyDisableSanitization?: boolean;
  /** Cache key for result caching */
  cacheKey?: string;
  /** Refetch when input changes */
  refetchOnInputChange?: boolean;
  /** Run on mount (default: true) */
  immediate?: boolean;
  /** Enable streaming output */
  stream?: boolean;
}

export interface InferRenderProps<T> {
  /** The inference result */
  data: T | null;
  /** Loading state */
  loading: boolean;
  /** Error if inference failed */
  error: Error | null;
  /** Whether result is from streaming */
  isStreaming: boolean;
  /** Manually trigger inference */
  refetch: () => Promise<void>;
}

// Simple in-memory cache
const inferCache = new Map<string, unknown>();

/**
 * Declarative inference component
 *
 * @example
 * ```tsx
 * <Infer task="Summarize" input={article}>
 *   {({ data, loading }) => (
 *     loading ? <Skeleton /> : <p>{data}</p>
 *   )}
 * </Infer>
 * ```
 */
export function Infer<T = string>({
  task,
  input,
  schema,
  children,
  fallback = null,
  errorFallback,
  dangerouslyDisableSanitization = false,
  cacheKey,
  refetchOnInputChange = true,
  immediate = true,
  stream = false,
}: InferProps<T>): ReactNode {
  const synapse = useSynapseContext();

  // State
  const [data, setData] = useState<T | null>(() => {
    if (cacheKey && inferCache.has(cacheKey)) {
      return inferCache.get(cacheKey) as T;
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // Track if mounted (SSR safety)
  const isMountedRef = useRef(false);
  const prevInputRef = useRef(input);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sanitize output for security
  const sanitizeResult = useCallback(
    (result: unknown): unknown => {
      if (dangerouslyDisableSanitization) {
        return result;
      }

      if (typeof result === "string") {
        const { sanitized } = sanitizeOutput(result);
        return sanitized;
      }

      if (typeof result === "object" && result !== null) {
        // Deep sanitize object values
        return JSON.parse(
          JSON.stringify(result, (_, value) => {
            if (typeof value === "string") {
              const { sanitized } = sanitizeOutput(value);
              return sanitized;
            }
            return value;
          })
        );
      }

      return result;
    },
    [dangerouslyDisableSanitization]
  );

  // Fetch function
  const fetchData = useCallback(async () => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Check cache
    if (cacheKey && inferCache.has(cacheKey)) {
      setData(inferCache.get(cacheKey) as T);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const prompt = buildInferencePrompt({
        task,
        input,
        outputFormat: schema ? "JSON" : "text",
      });

      synapse.log("Infer:", task);

      if (stream && synapse.provider.streamInference) {
        // Streaming mode
        setIsStreaming(true);
        let accumulated = "";

        for await (const chunk of synapse.provider.streamInference(prompt)) {
          if (abortControllerRef.current?.signal.aborted) break;

          accumulated += chunk;
          // Sanitize accumulated content before displaying
          const sanitized = sanitizeResult(accumulated) as T;
          setData(sanitized);
        }

        setIsStreaming(false);

        // Final validation if schema provided
        if (schema) {
          const validation = validateResponse(accumulated, schema);
          if (!validation.success) {
            throw new Error(
              `Validation failed: ${validation.errors
                .map((e) => e.message)
                .join(", ")}`
            );
          }
          const sanitized = sanitizeResult(validation.data) as T;
          setData(sanitized);
          if (cacheKey) inferCache.set(cacheKey, sanitized);
        } else {
          if (cacheKey) inferCache.set(cacheKey, sanitizeResult(accumulated));
        }
      } else {
        // Non-streaming mode
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
          result = sanitizeResult(validation.data) as T;
        } else {
          result = sanitizeResult(response.content) as T;
        }

        // Cache if key provided
        if (cacheKey) {
          inferCache.set(cacheKey, result);
        }

        setData(result);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        synapse.log("Infer error:", error);
      }
    } finally {
      setLoading(false);
    }
  }, [task, input, schema, cacheKey, stream, synapse, sanitizeResult]);

  // Initial fetch (client-side only for SSR safety)
  useEffect(() => {
    isMountedRef.current = true;

    if (immediate && !data) {
      fetchData();
    }

    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, [immediate]); // Intentionally minimal deps for SSR

  // Refetch on input change
  useEffect(() => {
    if (
      refetchOnInputChange &&
      prevInputRef.current !== input &&
      isMountedRef.current
    ) {
      prevInputRef.current = input;
      fetchData();
    }
  }, [input, refetchOnInputChange, fetchData]);

  // Render props
  const renderProps: InferRenderProps<T> = useMemo(
    () => ({
      data,
      loading,
      error,
      isStreaming,
      refetch: fetchData,
    }),
    [data, loading, error, isStreaming, fetchData]
  );

  // Handle loading state
  if (loading && !isStreaming && !data) {
    return <>{fallback}</>;
  }

  // Handle error state
  if (error && !data) {
    if (errorFallback) {
      return <>{errorFallback(error)}</>;
    }
    return null;
  }

  return <>{children(renderProps)}</>;
}

/**
 * Clear the Infer component cache
 */
export function clearInferCache(): void {
  inferCache.clear();
}

/**
 * Pre-populate the Infer cache (useful for SSR)
 */
export function primeInferCache<T>(key: string, value: T): void {
  inferCache.set(key, value);
}
