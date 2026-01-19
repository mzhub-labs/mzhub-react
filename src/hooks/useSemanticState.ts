/**
 * useSemanticState - The Main Hook
 *
 * A React hook that manages state through natural language intent.
 * This is the "Redux for AI" - it looks like a hook but runs a full inference runtime.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import { ZodSchema } from "zod";
import { useSynapseContext } from "../context";
import { buildPrompt } from "../compiler";
import { executeWithCorrection } from "../validation";
import {
  MachineState,
  StateContext,
  AuditEntry,
  createInitialContext,
  getNextState,
  createAuditEntry,
  calculateConfidence,
  isDestructiveChange,
} from "../utils";

export interface SemanticStateConfig<T> {
  /** Zod schema defining the state structure */
  schema: ZodSchema<T>;
  /** Initial state value */
  initialState: T;
  /** Context/persona for the AI (e.g., "You are a task manager...") */
  context?: string;
  /** Override confidence threshold for this state */
  confidenceThreshold?: number;
  /** Callback when state changes */
  onChange?: (newState: T, oldState: T) => void;
  /** Callback when gating is triggered (return true to accept, false to reject) */
  onGate?: (newState: T, oldState: T, confidence: number) => Promise<boolean>;
}

export interface SemanticStateMetadata {
  /** Current state machine state */
  status: MachineState;
  /** Error if in REJECTED state */
  error: Error | null;
  /** Current intent being processed */
  currentIntent: string | null;
  /** Number of correction retries */
  retryCount: number;
  /** Confidence score of last change */
  confidence: number;
  /** Whether a change is pending user confirmation */
  pendingConfirmation: boolean;
  /** Pending state awaiting confirmation */
  pendingState: unknown | null;
  /** Confirm pending change */
  confirmChange: () => void;
  /** Reject pending change */
  rejectChange: () => void;
  /** Full audit history */
  history: AuditEntry[];
  /** Reset error state to IDLE */
  reset: () => void;
}

export type DispatchFn = (intent: string) => Promise<void>;

export type UseSemanticStateReturn<T> = [T, DispatchFn, SemanticStateMetadata];

/**
 * The main semantic state hook
 */
export function useSemanticState<T>(
  config: SemanticStateConfig<T>
): UseSemanticStateReturn<T> {
  const {
    schema,
    initialState,
    context = "",
    confidenceThreshold,
    onChange,
    onGate,
  } = config;

  const synapse = useSynapseContext();
  const threshold = confidenceThreshold ?? synapse.config.confidenceThreshold;

  // Core state
  const [state, setState] = useState<T>(initialState);
  const [machineState, setMachineState] = useState<MachineState>("IDLE");
  const [stateContext, setStateContext] = useState<StateContext<T>>(() =>
    createInitialContext(initialState)
  );

  // Pending confirmation state
  const [pendingState, setPendingState] = useState<T | null>(null);
  const pendingResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null
  );

  // AbortController for race condition prevention
  // New dispatch cancels previous pending inference
  const abortControllerRef = useRef<AbortController | null>(null);

  // Transition helper
  const transition = useCallback(
    (event: string, payload?: unknown) => {
      setMachineState((current) => {
        const next = getNextState(current, event);
        if (next) {
          const entry = createAuditEntry({
            from: current,
            to: next,
            event,
            payload,
          });
          setStateContext((ctx) => ({
            ...ctx,
            history: [...ctx.history, entry],
          }));
          synapse.log(`Transition: ${current} -> ${next} (${event})`);
          return next;
        }
        synapse.log(`Invalid transition: ${current} + ${event}`);
        return current;
      });
    },
    [synapse]
  );

  // The dispatch function - sends natural language intent to the AI
  const dispatch: DispatchFn = useCallback(
    async (intent: string) => {
      // Cancel any previous pending inference (race condition prevention)
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        synapse.log("Cancelled previous inference");
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      synapse.log("Dispatch:", intent);

      setStateContext((ctx) => ({
        ...ctx,
        currentIntent: intent,
        error: null,
      }));
      transition("DISPATCH_NO_OPTIMISTIC");

      try {
        // Check if already aborted
        if (signal.aborted) {
          synapse.log("Dispatch aborted before inference");
          return;
        }

        // Build the prompt
        const prompt = buildPrompt({
          schema,
          currentState: state,
          intent,
          context,
        });

        synapse.log("Prompt built, starting inference...");

        // Execute with self-correction
        const result = await executeWithCorrection({
          prompt,
          schema,
          inference: async (p) => {
            const response = await synapse.provider.inference(p);
            return response.content;
          },
          config: {
            maxRetries: synapse.config.maxRetries,
            onRetry: (attempt, errors) => {
              synapse.log(`Correction attempt ${attempt}:`, errors);
              setStateContext((ctx) => ({ ...ctx, retryCount: attempt }));
              transition("RETRY");
            },
          },
        });

        transition("RESPONSE_RECEIVED");

        if (!result.success || result.data === null) {
          synapse.log("Validation failed after retries");
          setStateContext((ctx) => ({
            ...ctx,
            error: new Error("Failed to generate valid state after retries"),
          }));
          transition("MAX_RETRIES");
          return;
        }

        transition("VALID");

        const newState = result.data;
        const confidence = calculateConfidence({
          previousState: state,
          newState,
          intent,
        });

        synapse.log("Confidence:", confidence, "Threshold:", threshold);
        setStateContext((ctx) => ({ ...ctx, confidence }));

        // Check if gating is needed
        const isDestructive = isDestructiveChange(state, newState);
        const needsGating = confidence < threshold || isDestructive;

        if (needsGating) {
          synapse.log("Gating triggered");
          transition("NEEDS_CONFIRMATION");

          // If custom onGate handler provided, use it
          if (onGate) {
            const confirmed = await onGate(newState, state, confidence);
            if (confirmed) {
              setState(newState);
              onChange?.(newState, state);
              transition("USER_CONFIRMED");
            } else {
              transition("USER_REJECTED");
            }
          } else {
            // Wait for manual confirmation
            setPendingState(newState);
            const confirmed = await new Promise<boolean>((resolve) => {
              pendingResolverRef.current = resolve;
            });

            if (confirmed) {
              setState(newState);
              onChange?.(newState, state);
              transition("USER_CONFIRMED");
            } else {
              transition("USER_REJECTED");
            }
            setPendingState(null);
          }
        } else {
          // Auto-accept confident changes
          setState(newState);
          onChange?.(newState, state);
          transition("CONFIDENT");
        }

        transition("RESET");
      } catch (error) {
        synapse.log("Inference error:", error);
        setStateContext((ctx) => ({
          ...ctx,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
        transition("ERROR");
      }
    },
    [state, schema, context, threshold, synapse, transition, onChange, onGate]
  );

  // Confirmation handlers
  const confirmChange = useCallback(() => {
    pendingResolverRef.current?.(true);
    pendingResolverRef.current = null;
  }, []);

  const rejectChange = useCallback(() => {
    pendingResolverRef.current?.(false);
    pendingResolverRef.current = null;
  }, []);

  const reset = useCallback(() => {
    transition("RESET");
    setStateContext((ctx) => ({ ...ctx, error: null }));
  }, [transition]);

  // Build metadata object
  const metadata: SemanticStateMetadata = useMemo(
    () => ({
      status: machineState,
      error: stateContext.error,
      currentIntent: stateContext.currentIntent,
      retryCount: stateContext.retryCount,
      confidence: stateContext.confidence,
      pendingConfirmation: pendingState !== null,
      pendingState,
      confirmChange,
      rejectChange,
      history: stateContext.history,
      reset,
    }),
    [
      machineState,
      stateContext,
      pendingState,
      confirmChange,
      rejectChange,
      reset,
    ]
  );

  return [state, dispatch, metadata];
}
