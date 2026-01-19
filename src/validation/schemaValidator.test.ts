/**
 * Tests for Schema Validator
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  extractJson,
  validateResponse,
  validateAgainstSchema,
  formatErrorsForCorrection,
} from "./schemaValidator";

describe("extractJson", () => {
  it("extracts plain JSON", () => {
    const input = '{"name": "test", "value": 42}';
    const result = extractJson(input);
    expect(result).toBe(input);
  });

  it("extracts JSON from markdown code block", () => {
    const input = '```json\n{"name": "test"}\n```';
    const result = extractJson(input);
    expect(result).toBe('{"name": "test"}');
  });

  it("extracts JSON from plain code block", () => {
    const input = '```\n{"name": "test"}\n```';
    const result = extractJson(input);
    expect(result).toBe('{"name": "test"}');
  });

  it("extracts JSON with surrounding text", () => {
    const input = 'Here is the result:\n{"name": "test"}\nHope this helps!';
    const result = extractJson(input);
    expect(result).toBe('{"name": "test"}');
  });

  it("extracts JSON array", () => {
    const input = "[1, 2, 3]";
    const result = extractJson(input);
    expect(result).toBe("[1, 2, 3]");
  });

  it("returns empty string for invalid JSON", () => {
    const input = "This is not JSON at all";
    const result = extractJson(input);
    expect(result).toBe("");
  });

  it("handles nested JSON objects", () => {
    const input = '{"user": {"name": "test", "age": 25}}';
    const result = extractJson(input);
    expect(result).toBe(input);
  });
});

describe("validateAgainstSchema", () => {
  const TestSchema = z.object({
    name: z.string(),
    age: z.number(),
    email: z.string().email().optional(),
  });

  it("validates correct data", () => {
    const data = { name: "John", age: 30 };
    const result = validateAgainstSchema(TestSchema, data);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(data);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing required field", () => {
    const data = { name: "John" };
    const result = validateAgainstSchema(TestSchema, data);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].path).toContain("age");
  });

  it("rejects wrong type", () => {
    const data = { name: "John", age: "thirty" };
    const result = validateAgainstSchema(TestSchema, data);

    expect(result.success).toBe(false);
    expect(result.errors[0].path).toContain("age");
  });

  it("validates optional fields when present", () => {
    const data = { name: "John", age: 30, email: "invalid-email" };
    const result = validateAgainstSchema(TestSchema, data);

    expect(result.success).toBe(false);
    expect(result.errors[0].path).toContain("email");
  });

  it("passes with valid optional field", () => {
    const data = { name: "John", age: 30, email: "john@example.com" };
    const result = validateAgainstSchema(TestSchema, data);

    expect(result.success).toBe(true);
  });
});

describe("validateResponse", () => {
  const TodoSchema = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        done: z.boolean(),
      })
    ),
  });

  it("validates JSON response from LLM", () => {
    const response =
      '{"items": [{"id": "1", "text": "Buy milk", "done": false}]}';
    const result = validateResponse(response, TodoSchema);

    expect(result.success).toBe(true);
    expect(result.data?.items).toHaveLength(1);
  });

  it("extracts and validates from markdown", () => {
    const response = `Here's the updated state:
\`\`\`json
{"items": [{"id": "1", "text": "Buy milk", "done": true}]}
\`\`\``;
    const result = validateResponse(response, TodoSchema);

    expect(result.success).toBe(true);
    expect(result.data?.items[0].done).toBe(true);
  });

  it("fails on invalid JSON structure", () => {
    const response = '{"items": "not an array"}';
    const result = validateResponse(response, TodoSchema);

    expect(result.success).toBe(false);
  });

  it("fails on no JSON found", () => {
    const response = "I apologize, but I cannot generate JSON.";
    const result = validateResponse(response, TodoSchema);

    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("No JSON");
  });
});

describe("formatErrorsForCorrection", () => {
  it("formats errors for LLM correction prompt", () => {
    const errors = [
      {
        path: "items.0.id",
        message: "Expected string, received number",
        expected: "string",
        received: 123,
      },
      {
        path: "items.0.done",
        message: "Required",
        expected: "boolean",
        received: undefined,
      },
    ];

    const formatted = formatErrorsForCorrection(errors);

    expect(formatted).toContain("items.0.id");
    expect(formatted).toContain("Expected string");
    expect(formatted).toContain("items.0.done");
    expect(formatted).toContain("Required");
  });
});
