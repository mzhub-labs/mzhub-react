/**
 * Tests for Rollback Manager
 */

import { describe, it, expect, vi } from "vitest";
import { RollbackManager, createRollbackManager } from "./rollbackManager";

describe("RollbackManager", () => {
  describe("snapshot", () => {
    it("creates snapshot with unique ID", () => {
      const manager = createRollbackManager<{ count: number }>();

      const id1 = manager.snapshot({ count: 1 }, "First");
      const id2 = manager.snapshot({ count: 2 }, "Second");

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^snap_/);
    });

    it("deep clones data", () => {
      const manager = createRollbackManager<{ items: number[] }>();
      const data = { items: [1, 2, 3] };

      manager.snapshot(data, "Snapshot");
      data.items.push(4); // Mutate original

      const lastGood = manager.getLastGoodState();
      expect(lastGood?.items).toEqual([1, 2, 3]); // Snapshot unchanged
    });

    it("trims old snapshots", () => {
      const manager = createRollbackManager<number>({ maxSnapshots: 3 });

      manager.snapshot(1, "One");
      manager.snapshot(2, "Two");
      manager.snapshot(3, "Three");
      manager.snapshot(4, "Four");

      const history = manager.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0].data).toBe(2); // First one trimmed
    });
  });

  describe("getLastGoodState", () => {
    it("returns null when no snapshots", () => {
      const manager = createRollbackManager<number>();
      expect(manager.getLastGoodState()).toBeNull();
    });

    it("returns most recent snapshot", () => {
      const manager = createRollbackManager<number>();

      manager.snapshot(1, "First");
      manager.snapshot(2, "Second");
      manager.snapshot(3, "Third");

      expect(manager.getLastGoodState()).toBe(3);
    });
  });

  describe("rollbackTo", () => {
    it("rolls back to specific snapshot", () => {
      const manager = createRollbackManager<number>();

      const id1 = manager.snapshot(1, "One");
      manager.snapshot(2, "Two");
      manager.snapshot(3, "Three");

      const result = manager.rollbackTo(id1);

      expect(result).toBe(1);
      expect(manager.getHistory()).toHaveLength(1);
    });

    it("returns null for unknown ID", () => {
      const manager = createRollbackManager<number>();

      manager.snapshot(1, "One");

      expect(manager.rollbackTo("unknown_id")).toBeNull();
    });
  });

  describe("rollbackSteps", () => {
    it("rolls back by N steps", () => {
      const manager = createRollbackManager<number>();

      manager.snapshot(1, "One");
      manager.snapshot(2, "Two");
      manager.snapshot(3, "Three");
      manager.snapshot(4, "Four");

      const result = manager.rollbackSteps(2);

      expect(result).toBe(2);
      expect(manager.getLastGoodState()).toBe(2);
    });

    it("rolls back to oldest if steps exceed history", () => {
      const manager = createRollbackManager<number>();

      manager.snapshot(1, "One");
      manager.snapshot(2, "Two");

      const result = manager.rollbackSteps(10);

      expect(result).toBe(1);
    });
  });

  describe("autoRollback", () => {
    it("triggers onRollback callback", () => {
      const onRollback = vi.fn();
      const manager = createRollbackManager<number>({ onRollback });

      manager.snapshot(1, "Good state");

      manager.autoRollback(999, "Validation failed");

      expect(onRollback).toHaveBeenCalledWith(999, 1, "Validation failed");
    });

    it("returns last good state", () => {
      const manager = createRollbackManager<number>();

      manager.snapshot(1, "Good");

      const result = manager.autoRollback(999, "Bad");

      expect(result).toBe(1);
    });
  });

  describe("availableRollbacks", () => {
    it("returns correct count", () => {
      const manager = createRollbackManager<number>();

      expect(manager.availableRollbacks).toBe(0);

      manager.snapshot(1, "One");
      expect(manager.availableRollbacks).toBe(0);

      manager.snapshot(2, "Two");
      expect(manager.availableRollbacks).toBe(1);

      manager.snapshot(3, "Three");
      expect(manager.availableRollbacks).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all snapshots", () => {
      const manager = createRollbackManager<number>();

      manager.snapshot(1, "One");
      manager.snapshot(2, "Two");

      manager.clear();

      expect(manager.getHistory()).toHaveLength(0);
      expect(manager.getLastGoodState()).toBeNull();
    });
  });
});
