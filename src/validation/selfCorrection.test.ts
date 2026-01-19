/**
 * Tests for Self-Correction Loop
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { executeWithCorrection, buildCorrectionPrompt } from "./selfCorrection";

describe("executeWithCorrection", () => {
  const TestSchema = z.object({
    result: z.string(),
    confidence: z.number().min(0).max(1),
  });

  it("returns valid response on first try", async () => {
    const mockInference = vi
      .fn()
      .mockResolvedValue('{"result": "success", "confidence": 0.95}');

    const result = await executeWithCorrection({
      prompt: "Test prompt",
      schema: TestSchema,
      inference: mockInference,
    });

    expect(result.success).toBe(true);
    expect(result.data?.result).toBe("success");
    expect(mockInference).toHaveBeenCalledTimes(1);
  });

  it("retries on invalid response", async () => {
    const mockInference = vi
      .fn()
      .mockResolvedValueOnce('{"result": "test"}') // Missing confidence
      .mockResolvedValueOnce('{"result": "success", "confidence": 0.9}');

    const result = await executeWithCorrection({
      prompt: "Test prompt",
      schema: TestSchema,
      inference: mockInference,
    });

    expect(result.success).toBe(true);
    expect(mockInference).toHaveBeenCalledTimes(2);
  });

  it("fails after max retries", async () => {
    const mockInference = vi.fn().mockResolvedValue("invalid json");

    const result = await executeWithCorrection({
      prompt: "Test prompt",
      schema: TestSchema,
      inference: mockInference,
      config: { maxRetries: 2 },
    });

    expect(result.success).toBe(false);
    expect(mockInference).toHaveBeenCalledTimes(2); // maxRetries = 2
    expect(result.history).toHaveLength(2);
  });

  it("calls onRetry callback", async () => {
    const onRetry = vi.fn();
    const mockInference = vi
      .fn()
      .mockResolvedValueOnce("bad")
      .mockResolvedValueOnce('{"result": "ok", "confidence": 0.8}');

    await executeWithCorrection({
      prompt: "Test prompt",
      schema: TestSchema,
      inference: mockInference,
      config: { onRetry },
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Array));
  });

  it("includes correction context in retry prompt", async () => {
    const mockInference = vi
      .fn()
      .mockResolvedValueOnce('{"result": 123}') // Wrong type
      .mockResolvedValueOnce('{"result": "ok", "confidence": 0.8}');

    await executeWithCorrection({
      prompt: "Original prompt",
      schema: TestSchema,
      inference: mockInference,
    });

    // Second call should include correction context
    const secondCallPrompt = mockInference.mock.calls[1][0];
    expect(secondCallPrompt).toContain("PREVIOUS RESPONSE");
  });

  it("records all attempts in history", async () => {
    const mockInference = vi
      .fn()
      .mockResolvedValueOnce("attempt 1")
      .mockResolvedValueOnce("attempt 2")
      .mockResolvedValueOnce('{"result": "ok", "confidence": 0.5}');

    const result = await executeWithCorrection({
      prompt: "Test",
      schema: TestSchema,
      inference: mockInference,
      config: { maxRetries: 3 },
    });

    expect(result.success).toBe(true);
    expect(result.history).toHaveLength(3);
    expect(result.history[0].response).toBe("attempt 1");
  });
});

describe("buildCorrectionPrompt", () => {
  it("includes original prompt", () => {
    const prompt = buildCorrectionPrompt(
      "Original prompt here",
      "Bad response",
      [{ path: "field", message: "Invalid", expected: "string", received: 123 }]
    );

    expect(prompt).toContain("Original prompt here");
  });

  it("includes previous response", () => {
    const prompt = buildCorrectionPrompt("Prompt", '{"bad": "data"}', [
      {
        path: "field",
        message: "Missing",
        expected: "value",
        received: undefined,
      },
    ]);

    expect(prompt).toContain('{"bad": "data"}');
  });

  it("includes error details", () => {
    const prompt = buildCorrectionPrompt("Prompt", "Response", [
      {
        path: "user.name",
        message: "Required",
        expected: "string",
        received: undefined,
      },
      {
        path: "user.age",
        message: "Must be a number",
        expected: "number",
        received: "abc",
      },
    ]);

    expect(prompt).toContain("user.name");
    expect(prompt).toContain("Required");
    expect(prompt).toContain("user.age");
  });
});
