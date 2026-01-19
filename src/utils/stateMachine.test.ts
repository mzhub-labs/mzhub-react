/**
 * Tests for State Machine
 */

import { describe, it, expect } from "vitest";
import {
  createInitialContext,
  getNextState,
  createAuditEntry,
  calculateConfidence,
  isDestructiveChange,
  type MachineState,
} from "./stateMachine";

describe("State Machine", () => {
  describe("createInitialContext", () => {
    it("creates context with initial data", () => {
      const initial = { count: 0 };
      const context = createInitialContext(initial);

      expect(context.data).toEqual(initial);
      expect(context.optimisticData).toBeNull();
      expect(context.currentIntent).toBeNull();
      expect(context.error).toBeNull();
      expect(context.retryCount).toBe(0);
      expect(context.confidence).toBe(1);
      expect(context.history).toEqual([]);
    });
  });

  describe("getNextState", () => {
    const testTransitions: [MachineState, string, MachineState | null][] = [
      ["IDLE", "DISPATCH", "OPTIMISTIC"],
      ["IDLE", "DISPATCH_NO_OPTIMISTIC", "GENERATING"],
      ["OPTIMISTIC", "START_INFERENCE", "GENERATING"],
      ["GENERATING", "RESPONSE_RECEIVED", "VALIDATING"],
      ["GENERATING", "ERROR", "REJECTED"],
      ["VALIDATING", "VALID", "GATING"],
      ["VALIDATING", "INVALID", "CORRECTING"],
      ["CORRECTING", "RETRY", "GENERATING"],
      ["CORRECTING", "MAX_RETRIES", "REJECTED"],
      ["GATING", "CONFIDENT", "SETTLED"],
      ["GATING", "USER_CONFIRMED", "SETTLED"],
      ["GATING", "USER_REJECTED", "REJECTED"],
      ["SETTLED", "RESET", "IDLE"],
      ["REJECTED", "RESET", "IDLE"],
      // Invalid transitions
      ["IDLE", "INVALID_EVENT", null],
      ["SETTLED", "DISPATCH", null],
    ];

    testTransitions.forEach(([from, event, expected]) => {
      it(`${from} + ${event} -> ${expected ?? "null"}`, () => {
        expect(getNextState(from, event)).toBe(expected);
      });
    });
  });

  describe("createAuditEntry", () => {
    it("creates entry with unique ID", () => {
      const entry1 = createAuditEntry({
        from: "IDLE",
        to: "GENERATING",
        event: "DISPATCH",
      });
      const entry2 = createAuditEntry({
        from: "IDLE",
        to: "GENERATING",
        event: "DISPATCH",
      });

      expect(entry1.id).not.toBe(entry2.id);
      expect(entry1.id).toMatch(/^txn_/);
    });

    it("includes timestamp", () => {
      const before = Date.now();
      const entry = createAuditEntry({
        from: "IDLE",
        to: "GENERATING",
        event: "DISPATCH",
      });
      const after = Date.now();

      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });

    it("includes payload if provided", () => {
      const entry = createAuditEntry({
        from: "IDLE",
        to: "GENERATING",
        event: "DISPATCH",
        payload: { intent: "Add task" },
      });

      expect(entry.payload).toEqual({ intent: "Add task" });
    });
  });

  describe("calculateConfidence", () => {
    it("returns high confidence for small changes", () => {
      const prev = { items: [{ id: "1", text: "Task 1" }] };
      const next = { items: [{ id: "1", text: "Task 1 updated" }] };

      const confidence = calculateConfidence({
        previousState: prev,
        newState: next,
        intent: "Update task text",
      });

      expect(confidence).toBeGreaterThan(0.5);
    });

    it("returns lower confidence for large changes", () => {
      const prev = { items: [{ id: "1" }, { id: "2" }, { id: "3" }] };
      const next = { items: [] };

      const confidence = calculateConfidence({
        previousState: prev,
        newState: next,
        intent: "Delete all",
      });

      expect(confidence).toBeLessThan(0.7);
    });

    it("uses model confidence when provided", () => {
      const confidence = calculateConfidence({
        previousState: { x: 1 },
        newState: { x: 2 },
        intent: "Change x",
        modelConfidence: 0.9,
      });

      // Should incorporate the high model confidence
      expect(confidence).toBeGreaterThan(0.6);
    });

    it("handles clear intent better", () => {
      const shortIntent = calculateConfidence({
        previousState: { x: 1 },
        newState: { x: 2 },
        intent: "x",
      });

      const clearIntent = calculateConfidence({
        previousState: { x: 1 },
        newState: { x: 2 },
        intent: "Please change x to be 2 instead of 1",
      });

      expect(clearIntent).toBeGreaterThan(shortIntent);
    });
  });

  describe("isDestructiveChange", () => {
    it("detects large data reduction", () => {
      const prev = { data: "a".repeat(100) };
      const next = { data: "b" };

      expect(isDestructiveChange(prev, next)).toBe(true);
    });

    it("detects array deletion", () => {
      const prev = [1, 2, 3, 4, 5];
      const next: number[] = [];

      expect(isDestructiveChange(prev, next)).toBe(true);
    });

    it("allows normal updates", () => {
      const prev = { count: 1 };
      const next = { count: 2 };

      expect(isDestructiveChange(prev, next)).toBe(false);
    });

    it("allows additions", () => {
      const prev = { items: [1] };
      const next = { items: [1, 2, 3] };

      expect(isDestructiveChange(prev, next)).toBe(false);
    });
  });
});
