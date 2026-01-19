/**
 * Rollback Manager - Automatic state recovery on failure
 *
 * Addresses: Enhanced Firewall pre-mortem risk
 *
 * Guarantees:
 * - State is snapshotted before each dispatch
 * - Automatic rollback on validation failure
 * - Configurable history depth
 */

export interface StateSnapshot<T> {
  id: string;
  timestamp: number;
  data: T;
  intent: string;
}

export interface RollbackManagerConfig {
  /** Maximum number of snapshots to keep */
  maxSnapshots?: number;
  /** Called when a rollback occurs */
  onRollback?: (from: unknown, to: unknown, reason: string) => void;
}

export class RollbackManager<T> {
  private snapshots: StateSnapshot<T>[] = [];
  private maxSnapshots: number;
  private onRollback?: (from: unknown, to: unknown, reason: string) => void;

  constructor(config: RollbackManagerConfig = {}) {
    this.maxSnapshots = config.maxSnapshots ?? 10;
    this.onRollback = config.onRollback;
  }

  /**
   * Takes a snapshot of the current state before a dispatch
   */
  snapshot(data: T, intent: string): string {
    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const snapshot: StateSnapshot<T> = {
      id,
      timestamp: Date.now(),
      data: this.deepClone(data),
      intent,
    };

    this.snapshots.push(snapshot);

    // Trim old snapshots
    while (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return id;
  }

  /**
   * Gets the last known good state (most recent snapshot)
   */
  getLastGoodState(): T | null {
    if (this.snapshots.length === 0) return null;
    return this.deepClone(this.snapshots[this.snapshots.length - 1].data);
  }

  /**
   * Rolls back to a specific snapshot by ID
   */
  rollbackTo(snapshotId: string): T | null {
    const index = this.snapshots.findIndex((s) => s.id === snapshotId);
    if (index === -1) return null;

    const targetSnapshot = this.snapshots[index];

    // Remove all snapshots after the target
    this.snapshots = this.snapshots.slice(0, index + 1);

    return this.deepClone(targetSnapshot.data);
  }

  /**
   * Rolls back by N steps
   */
  rollbackSteps(steps: number): T | null {
    const targetIndex = this.snapshots.length - 1 - steps;
    if (targetIndex < 0) {
      // Rollback to the oldest snapshot we have
      if (this.snapshots.length > 0) {
        return this.deepClone(this.snapshots[0].data);
      }
      return null;
    }

    const targetSnapshot = this.snapshots[targetIndex];
    this.snapshots = this.snapshots.slice(0, targetIndex + 1);

    return this.deepClone(targetSnapshot.data);
  }

  /**
   * Performs automatic rollback and notifies
   */
  autoRollback(currentState: T, reason: string): T | null {
    const lastGood = this.getLastGoodState();

    if (lastGood !== null) {
      this.onRollback?.(currentState, lastGood, reason);
    }

    return lastGood;
  }

  /**
   * Gets the full snapshot history
   */
  getHistory(): StateSnapshot<T>[] {
    return this.snapshots.map((s) => ({
      ...s,
      data: this.deepClone(s.data),
    }));
  }

  /**
   * Clears all snapshots
   */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Gets the number of snapshots available for rollback
   */
  get availableRollbacks(): number {
    return Math.max(0, this.snapshots.length - 1);
  }

  private deepClone(data: T): T {
    // Fast path for primitives
    if (data === null || typeof data !== "object") {
      return data;
    }
    // Use structured clone if available, fallback to JSON
    if (typeof structuredClone === "function") {
      return structuredClone(data);
    }
    return JSON.parse(JSON.stringify(data));
  }
}

/**
 * Creates a rollback manager with default settings
 */
export function createRollbackManager<T>(
  config?: RollbackManagerConfig
): RollbackManager<T> {
  return new RollbackManager<T>(config);
}
