/**
 * Tests for Prompt Builder
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  zodToDescription,
  buildPrompt,
  buildInferencePrompt,
} from "./promptBuilder";

describe("Prompt Builder", () => {
  describe("zodToDescription", () => {
    it("describes string type", () => {
      const schema = z.string();
      expect(zodToDescription(schema)).toBe("string");
    });

    it("describes number type", () => {
      const schema = z.number();
      expect(zodToDescription(schema)).toBe("number");
    });

    it("describes boolean type", () => {
      const schema = z.boolean();
      expect(zodToDescription(schema)).toBe("boolean");
    });

    it("describes array type", () => {
      const schema = z.array(z.string());
      expect(zodToDescription(schema)).toBe("string[]");
    });

    it("describes enum type", () => {
      const schema = z.enum(["low", "medium", "high"]);
      expect(zodToDescription(schema)).toBe('"low" | "medium" | "high"');
    });

    it("describes object type", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const desc = zodToDescription(schema);

      expect(desc).toContain("name: string");
      expect(desc).toContain("age: number");
    });

    it("describes optional type", () => {
      const schema = z.string().optional();
      expect(zodToDescription(schema)).toBe("string | undefined");
    });

    it("describes nullable type", () => {
      const schema = z.string().nullable();
      expect(zodToDescription(schema)).toBe("string | null");
    });

    it("describes nested objects", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
        }),
      });
      const desc = zodToDescription(schema);

      expect(desc).toContain("user:");
      expect(desc).toContain("name: string");
      expect(desc).toContain("email: string");
    });

    it("describes complex todo schema", () => {
      const TodoSchema = z.object({
        items: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            priority: z.enum(["low", "medium", "high"]),
            done: z.boolean(),
          })
        ),
      });

      const desc = zodToDescription(TodoSchema);

      expect(desc).toContain("items:");
      expect(desc).toContain("id: string");
      expect(desc).toContain("priority:");
      expect(desc).toContain('"low"');
      expect(desc).toContain("done: boolean");
    });
  });

  describe("buildPrompt", () => {
    const TestSchema = z.object({
      items: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
        })
      ),
    });

    it("includes schema description", () => {
      const prompt = buildPrompt({
        schema: TestSchema,
        currentState: { items: [] },
        intent: "Add a task",
      });

      expect(prompt).toContain("SCHEMA:");
      expect(prompt).toContain("items:");
      expect(prompt).toContain("id: string");
    });

    it("includes current state as JSON", () => {
      const state = { items: [{ id: "1", text: "Test" }] };
      const prompt = buildPrompt({
        schema: TestSchema,
        currentState: state,
        intent: "Add a task",
      });

      expect(prompt).toContain("CURRENT STATE:");
      expect(prompt).toContain('"id": "1"');
      expect(prompt).toContain('"text": "Test"');
    });

    it("includes user intent", () => {
      const prompt = buildPrompt({
        schema: TestSchema,
        currentState: { items: [] },
        intent: "Add buy milk task",
      });

      expect(prompt).toContain("USER INTENT:");
      expect(prompt).toContain("Add buy milk task");
    });

    it("includes context when provided", () => {
      const prompt = buildPrompt({
        schema: TestSchema,
        currentState: { items: [] },
        intent: "Add task",
        context: "You are a task manager for a busy professional.",
      });

      expect(prompt).toContain("CONTEXT:");
      expect(prompt).toContain("task manager");
    });

    it("instructs to output only JSON", () => {
      const prompt = buildPrompt({
        schema: TestSchema,
        currentState: { items: [] },
        intent: "Add task",
      });

      expect(prompt).toContain("Output ONLY");
      expect(prompt).toContain("valid JSON");
    });
  });

  describe("buildInferencePrompt", () => {
    it("includes task description", () => {
      const prompt = buildInferencePrompt({
        task: "Summarize this text",
        input: "Some long article...",
      });

      expect(prompt).toContain("TASK: Summarize this text");
    });

    it("includes input", () => {
      const prompt = buildInferencePrompt({
        task: "Translate",
        input: "Hello world",
      });

      expect(prompt).toContain("INPUT:");
      expect(prompt).toContain("Hello world");
    });

    it("includes output format", () => {
      const prompt = buildInferencePrompt({
        task: "Parse",
        input: "data",
        outputFormat: "JSON",
      });

      expect(prompt).toContain("OUTPUT FORMAT: JSON");
    });

    it("defaults to text format", () => {
      const prompt = buildInferencePrompt({
        task: "Describe",
        input: "image",
      });

      expect(prompt).toContain("OUTPUT FORMAT: text");
    });
  });
});
