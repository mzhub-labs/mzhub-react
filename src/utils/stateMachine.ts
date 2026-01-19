/**
 * State Machine - The 7-state lifecycle for semantic state mutations
 */

export type MachineState =
  | "IDLE"
  | "OPTIMISTIC"
  | "GENERATING"
  | "VALIDATING"
  | "CORRECTING"
  | "GATING"
  | "SETTLED"
  | "REJECTED";

export interface StateContext<T> {
  data: T;
  optimisticData: T | null;
  currentIntent: string | null;
  error: Error | null;
  retryCount: number;
  confidence: number;
  history: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  from: MachineState;
  to: MachineState;
  event: string;
  payload?: unknown;
}

interface Transition {
  from: MachineState;
  event: string;
  to: MachineState;
}

const TRANSITIONS: Transition[] = [
  { from: "IDLE", event: "DISPATCH", to: "OPTIMISTIC" },
  { from: "IDLE", event: "DISPATCH_NO_OPTIMISTIC", to: "GENERATING" },
  { from: "OPTIMISTIC", event: "START_INFERENCE", to: "GENERATING" },
  { from: "GENERATING", event: "RESPONSE_RECEIVED", to: "VALIDATING" },
  { from: "GENERATING", event: "ERROR", to: "REJECTED" },
  { from: "VALIDATING", event: "VALID", to: "GATING" },
  { from: "VALIDATING", event: "INVALID", to: "CORRECTING" },
  { from: "CORRECTING", event: "RETRY", to: "GENERATING" },
  { from: "CORRECTING", event: "MAX_RETRIES", to: "REJECTED" },
  { from: "GATING", event: "CONFIDENT", to: "SETTLED" },
  { from: "GATING", event: "NEEDS_CONFIRMATION", to: "GATING" },
  { from: "GATING", event: "USER_CONFIRMED", to: "SETTLED" },
  { from: "GATING", event: "USER_REJECTED", to: "REJECTED" },
  { from: "SETTLED", event: "RESET", to: "IDLE" },
  { from: "REJECTED", event: "RESET", to: "IDLE" },
];

/**
 * Creates the initial state context
 */
export function createInitialContext<T>(initialData: T): StateContext<T> {
  return {
    data: initialData,
    optimisticData: null,
    currentIntent: null,
    error: null,
    retryCount: 0,
    confidence: 1,
    history: [],
  };
}

/**
 * Gets the next state for a given transition
 */
export function getNextState(
  from: MachineState,
  event: string
): MachineState | null {
  const transition = TRANSITIONS.find(
    (t) => t.from === from && t.event === event
  );
  return transition ? transition.to : null;
}

/**
 * Creates an audit log entry for a state transition
 */
export function createAuditEntry(params: {
  from: MachineState;
  to: MachineState;
  event: string;
  payload?: unknown;
}): AuditEntry {
  return {
    id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    ...params,
  };
}

export interface ConfidenceParams<T> {
  previousState: T;
  newState: T;
  intent: string;
  modelConfidence?: number;
}

/**
 * Calculates confidence score for a state change
 */
export function calculateConfidence<T>({
  previousState,
  newState,
  intent,
  modelConfidence = 0.7,
}: ConfidenceParams<T>): number {
  const prevString = JSON.stringify(previousState);
  const newString = JSON.stringify(newState);

  const maxLen = Math.max(prevString.length, newString.length);
  let sameChars = 0;
  for (let i = 0; i < Math.min(prevString.length, newString.length); i++) {
    if (prevString[i] === newString[i]) sameChars++;
  }
  const diffRatio = 1 - sameChars / maxLen;
  const intentClarity = Math.min(1, intent.length / 50);

  const confidence =
    modelConfidence * 0.4 + (1 - diffRatio) * 0.3 + intentClarity * 0.3;

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Checks if a change appears destructive
 */
export function isDestructiveChange<T>(previousState: T, newState: T): boolean {
  const prevSize = JSON.stringify(previousState).length;
  const newSize = JSON.stringify(newState).length;

  if (prevSize > 50 && newSize < prevSize * 0.3) {
    return true;
  }

  if (Array.isArray(previousState) && Array.isArray(newState)) {
    if (previousState.length > 0 && newState.length === 0) {
      return true;
    }
  }

  return false;
}
