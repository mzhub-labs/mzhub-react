/**
 * Schema Validator - The Firewall that prevents bad AI output from reaching the UI
 */

import { z, ZodSchema, ZodError } from "zod";

export interface ValidationError {
  path: string;
  message: string;
  expected: string;
  received: unknown;
}

export interface ValidationResult<T> {
  success: boolean;
  data: T | null;
  errors: ValidationError[];
  rawJson: string;
}

/**
 * Extracts JSON from an LLM response that may be wrapped in markdown code blocks
 */
export function extractJson(response: string): string {
  if (!response || typeof response !== "string") {
    return "";
  }

  let text = response.trim();

  // Try to extract from markdown code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // Try to find JSON object or array boundaries
  const jsonStart = text.search(/[\[{]/);
  const jsonEndBracket = text.lastIndexOf("]");
  const jsonEndBrace = text.lastIndexOf("}");
  const jsonEnd = Math.max(jsonEndBracket, jsonEndBrace);

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    return text.slice(jsonStart, jsonEnd + 1);
  }

  // No valid JSON boundaries found
  return "";
}

/**
 * Validates parsed JSON against a Zod schema
 */
export function validateAgainstSchema<T>(
  schema: ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
      errors: [],
      rawJson: JSON.stringify(data),
    };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    expected: (issue as any).expected || "valid value",
    received: (issue as any).received,
  }));

  return {
    success: false,
    data: null,
    errors,
    rawJson: JSON.stringify(data),
  };
}

/**
 * Full validation pipeline: extract JSON, parse, validate against schema
 */
export function validateResponse<T>(
  response: string,
  schema: ZodSchema<T>
): ValidationResult<T> {
  // Step 1: Extract JSON from response
  const jsonString = extractJson(response);

  if (!jsonString) {
    return {
      success: false,
      data: null,
      errors: [
        {
          path: "",
          message: "No JSON found in response",
          expected: "JSON object or array",
          received: response.slice(0, 100) + "...",
        },
      ],
      rawJson: "",
    };
  }

  // Step 2: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (parseError) {
    return {
      success: false,
      data: null,
      errors: [
        {
          path: "",
          message: `JSON parse error: ${(parseError as Error).message}`,
          expected: "Valid JSON",
          received: jsonString.slice(0, 100) + "...",
        },
      ],
      rawJson: jsonString,
    };
  }

  // Step 3: Validate against schema
  return validateAgainstSchema(schema, parsed);
}

/**
 * Formats validation errors into a string for self-correction prompts
 */
export function formatErrorsForCorrection(errors: ValidationError[]): string {
  if (errors.length === 0) return "";

  const lines = errors.map((err) => {
    if (err.path) {
      return `- Field "${err.path}": ${err.message}. Expected: ${
        err.expected
      }, got: ${JSON.stringify(err.received)}`;
    }
    return `- ${err.message}`;
  });

  return `The following validation errors occurred:\n${lines.join("\n")}`;
}
