/**
 * SSR-Safe Hooks - Hydration-safe versions of Synapse hooks
 *
 * Addresses: Hydration Mismatch (SSR Hell) pre-mortem risk
 *
 * Strategy:
 * 1. Render deterministic skeleton on server
 * 2. Only trigger AI in useEffect (client-only)
 * 3. Server and client initial HTML always match
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { ZodSchema } from "zod";
import { useSynapseContext, useSynapseConfig } from "../context";
import { buildPrompt } from "../compiler";
import { executeWithCorrection, validateResponse } from "../validation";
import { sanitizeOutput } from "../security";

/**
 * Check if we're on the server (SSR)
 */
export function useIsServer(): boolean {
  const [isServer, setIsServer] = useState(true);

  useEffect(() => {
    setIsServer(false);
  }, []);

  return isServer;
}

/**
 * Check if component has hydrated (client-side)
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}

export interface SSRSemanticStateConfig<T> {
  /** Zod schema defining the state structure */
  schema: ZodSchema<T>;
  /** Initial state value (used for SSR) */
  initialState: T;
  /** Context/persona for the AI */
  context?: string;
  /** Confidence threshold */
  confidenceThreshold?: number;
  /** Initial intent to run on mount (client-only) */
  initialIntent?: string;
}

export interface SSRSemanticStateReturn<T> {
  /** Current state */
  state: T;
  /** Dispatch an intent */
  dispatch: (intent: string) => Promise<void>;
  /** Whether currently loading */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether hydration is complete */
  hydrated: boolean;
  /** Whether running on server */
  isServer: boolean;
}

/**
 * SSR-safe semantic state hook
 *
 * - On server: Returns initialState, never runs AI
 * - On client: Hydrates with initialState first, then runs AI
 *
 * @example
 * ```tsx
 * function TaskList() {
 *   const { state, dispatch, loading, hydrated } = useSSRSemanticState({
 *     schema: TodoSchema,
 *     initialState: { items: [] },
 *     initialIntent: 'Load default tasks' // Runs after hydration
 *   });
 *
 *   if (!hydrated) return <Skeleton />;
 *   // ...
 * }
 * ```
 */
export function useSSRSemanticState<T>(
  config: SSRSemanticStateConfig<T>
): SSRSemanticStateReturn<T> {
  const {
    schema,
    initialState,
    context = "",
    confidenceThreshold,
    initialIntent,
  } = config;

  const { isConfigured } = useSynapseConfig();
  const hydrated = useHydrated();
  const isServer = useIsServer();

  // Always start with initialState for SSR determinism
  const [state, setState] = useState<T>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasInitialRunRef = useRef(false);

  // Get synapse context only if configured
  let synapse: ReturnType<typeof useSynapseContext> | null = null;
  try {
    if (isConfigured) {
      synapse = useSynapseContext();
    }
  } catch {
    // Not configured, continue without synapse
  }

  const dispatch = useCallback(
    async (intent: string) => {
      if (isServer || !synapse) {
        // Don't run on server
        return;
      }

      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const prompt = buildPrompt({
          schema,
          currentState: state,
          intent,
          context,
        });

        const result = await executeWithCorrection({
          prompt,
          schema,
          inference: async (p) => {
            const response = await synapse!.provider.inference(p);
            return response.content;
          },
          config: {
            maxRetries: synapse.config.maxRetries,
          },
        });

        if (!abortControllerRef.current?.signal.aborted) {
          if (result.success && result.data !== null) {
            setState(result.data);
          } else {
            setError(new Error("Failed to generate valid state"));
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!abortControllerRef.current?.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [isServer, state, schema, context, synapse]
  );

  // Run initial intent after hydration (client-only)
  useEffect(() => {
    if (hydrated && initialIntent && !hasInitialRunRef.current && synapse) {
      hasInitialRunRef.current = true;
      dispatch(initialIntent);
    }
  }, [hydrated, initialIntent, dispatch, synapse]);

  // Cleanup
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    state,
    dispatch,
    loading,
    error,
    hydrated,
    isServer,
  };
}

export interface SSRInferenceConfig {
  /** The task/prompt to run */
  task: string;
  /** Input data to process */
  input: string;
  /** Optional Zod schema for structured output */
  schema?: ZodSchema<unknown>;
  /** Fallback value for SSR */
  fallback?: unknown;
  /** Sanitize output (default: true) */
  sanitize?: boolean;
}

export interface SSRInferenceReturn<T> {
  /** Inference result */
  data: T | null;
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether hydration is complete */
  hydrated: boolean;
  /** Trigger inference manually */
  run: () => Promise<void>;
}

/**
 * SSR-safe inference hook
 */
export function useSSRInference<T = string>(
  config: SSRInferenceConfig
): SSRInferenceReturn<T> {
  const { task, input, schema, fallback = null, sanitize = true } = config;

  const hydrated = useHydrated();
  const isServer = useIsServer();
  const { isConfigured } = useSynapseConfig();

  const [data, setData] = useState<T | null>(fallback as T | null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  let synapse: ReturnType<typeof useSynapseContext> | null = null;
  try {
    if (isConfigured) {
      synapse = useSynapseContext();
    }
  } catch {
    // Not configured
  }

  const run = useCallback(async () => {
    if (isServer || !synapse) return;

    setLoading(true);
    setError(null);

    try {
      const response = await synapse.provider.inference(
        `TASK: ${task}\n\nINPUT:\n${input}\n\nRespond with ONLY the result.`
      );

      let result: T;

      if (schema) {
        const validation = validateResponse(response.content, schema);
        if (!validation.success) {
          throw new Error("Validation failed");
        }
        result = validation.data as T;
      } else {
        result = response.content as T;
      }

      // Sanitize if enabled
      if (sanitize && typeof result === "string") {
        result = sanitizeOutput(result).sanitized as T;
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [isServer, task, input, schema, sanitize, synapse]);

  // Auto-run after hydration
  useEffect(() => {
    if (hydrated && synapse) {
      run();
    }
  }, [hydrated, run, synapse]);

  return {
    data,
    loading,
    error,
    hydrated,
    run,
  };
}
