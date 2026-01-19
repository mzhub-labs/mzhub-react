/**
 * Prompt Builder - Compiles structured prompts for the LLM
 */

import {
  ZodSchema,
  ZodObject,
  ZodArray,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodEnum,
  ZodOptional,
  ZodNullable,
  ZodUnion,
  ZodDefault,
  ZodLiteral,
  ZodTypeDef,
} from "zod";

/**
 * Converts a Zod schema to a human-readable TypeScript-like description
 */
export function zodToDescription(schema: ZodSchema): string {
  const def = (schema as any)._def;
  if (!def) return "unknown";
  return describeZodType(def);
}

function describeZodType(
  def: ZodTypeDef & { typeName?: string },
  indent = 0
): string {
  const spaces = "  ".repeat(indent);
  const typeName = (def as any).typeName;

  switch (typeName) {
    case "ZodObject": {
      const shape = (def as any).shape();
      const fields = Object.entries(shape).map(([key, value]) => {
        const fieldType = describeZodType((value as any)._def, indent + 1);
        return `${spaces}  ${key}: ${fieldType}`;
      });
      return `{\n${fields.join(",\n")}\n${spaces}}`;
    }

    case "ZodArray": {
      const itemType = describeZodType((def as any).type._def, indent);
      return `${itemType}[]`;
    }

    case "ZodString":
      return "string";

    case "ZodNumber":
      return "number";

    case "ZodBoolean":
      return "boolean";

    case "ZodEnum": {
      const values = (def as any).values
        .map((v: string) => `"${v}"`)
        .join(" | ");
      return values;
    }

    case "ZodLiteral":
      return JSON.stringify((def as any).value);

    case "ZodOptional": {
      const innerType = describeZodType((def as any).innerType._def, indent);
      return `${innerType} | undefined`;
    }

    case "ZodNullable": {
      const innerType = describeZodType((def as any).innerType._def, indent);
      return `${innerType} | null`;
    }

    case "ZodUnion": {
      const types = (def as any).options.map((opt: any) =>
        describeZodType(opt._def, indent)
      );
      return types.join(" | ");
    }

    case "ZodDefault": {
      return describeZodType((def as any).innerType._def, indent);
    }

    default:
      return "unknown";
  }
}

export interface PromptConfig<T> {
  schema: ZodSchema<T>;
  currentState: T;
  intent: string;
  context?: string;
}

/**
 * Builds a complete prompt for semantic state mutation
 */
export function buildPrompt<T>({
  schema,
  currentState,
  intent,
  context = "",
}: PromptConfig<T>): string {
  const schemaDescription = zodToDescription(schema);
  const stateJson = JSON.stringify(currentState, null, 2);

  const contextSection = context ? `\nCONTEXT:\n${context}\n` : "";

  return `SYSTEM:
You are a state manager for a React application.
You must output valid JSON that matches the following TypeScript schema.
${contextSection}
SCHEMA:
${schemaDescription}

CURRENT STATE:
${stateJson}

USER INTENT:
"${intent}"

INSTRUCTIONS:
1. Analyze the USER INTENT and determine what changes to make to CURRENT STATE.
2. Apply the changes while maintaining the schema structure.
3. Preserve existing data unless the intent explicitly requires removing it.
4. Generate new unique IDs for new items (use format: "id_" + random alphanumeric).
5. Output ONLY the new complete state as valid JSON.
6. Do NOT include any explanation, markdown, or extra text.

OUTPUT:`;
}

export interface InferencePromptConfig {
  task: string;
  input: string;
  outputFormat?: string;
}

/**
 * Builds a minimal prompt for simple inference tasks
 */
export function buildInferencePrompt({
  task,
  input,
  outputFormat = "text",
}: InferencePromptConfig): string {
  return `TASK: ${task}

INPUT:
${input}

OUTPUT FORMAT: ${outputFormat}

Respond with ONLY the result, no explanation.`;
}
