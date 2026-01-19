/**
 * Prompt Guard - Security layer for AI inputs
 *
 * Addresses: System Prompt Leak pre-mortem risk
 *
 * Rules:
 * 1. Client-side AI is for augmentation, not validation
 * 2. Detect and block prompt injection attempts
 * 3. Protect sensitive fields from AI modification
 * 4. Audit all AI-generated state changes
 */

import { SynapseError, Errors } from "../errors";

export interface PromptGuardConfig {
  /** Fields that AI cannot modify directly */
  sensitiveFields?: string[];
  /** Custom injection patterns to detect */
  customPatterns?: RegExp[];
  /** Enable strict mode (block more aggressively) */
  strictMode?: boolean;
  /** Called when a security violation is detected */
  onViolation?: (violation: SecurityViolation) => void;
}

export interface SecurityViolation {
  type: "injection" | "sensitive_access" | "blocked_pattern";
  intent: string;
  pattern?: string;
  field?: string;
  timestamp: number;
}

// Common prompt injection patterns
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /ignore\s+(all\s+)?above/i,
  /disregard\s+(all\s+)?previous/i,
  /forget\s+(everything|all)/i,
  /you\s+are\s+now\s+(a|an)/i,
  /pretend\s+to\s+be/i,
  /act\s+as\s+(if|a|an)/i,
  /system\s*:\s*/i,
  /\[system\]/i,
  /<<\s*SYS\s*>>/i,
  /\{\{.*system.*\}\}/i,
  /output\s+(the|your)\s+(system|original)\s+prompt/i,
  /reveal\s+(your|the)\s+instructions/i,
  /what\s+(are|is)\s+your\s+(system\s+)?prompt/i,
];

// Patterns that indicate sensitive data access
const SENSITIVE_PATTERNS: RegExp[] = [
  /credit\s*card/i,
  /card\s*number/i,
  /cvv|cvc|security\s*code/i,
  /social\s*security/i,
  /\bssn\b/i,
  /password|passwd/i,
  /api\s*key/i,
  /secret\s*key/i,
  /private\s*key/i,
  /auth\s*token/i,
  /bearer\s+token/i,
];

export class PromptGuard {
  private config: Required<PromptGuardConfig>;
  private violations: SecurityViolation[] = [];
  private allPatterns: RegExp[];

  constructor(config: PromptGuardConfig = {}) {
    this.config = {
      sensitiveFields: config.sensitiveFields ?? [],
      customPatterns: config.customPatterns ?? [],
      strictMode: config.strictMode ?? false,
      onViolation: config.onViolation ?? (() => {}),
    };

    this.allPatterns = [...INJECTION_PATTERNS, ...this.config.customPatterns];
  }

  /**
   * Validates an intent before sending to AI
   * Throws SynapseError if blocked
   */
  validateIntent(intent: string): void {
    // Check for injection patterns
    for (const pattern of this.allPatterns) {
      if (pattern.test(intent)) {
        const violation: SecurityViolation = {
          type: "injection",
          intent,
          pattern: pattern.source,
          timestamp: Date.now(),
        };
        this.recordViolation(violation);
        throw Errors.securityViolation(
          "Potential prompt injection detected",
          intent
        );
      }
    }

    // In strict mode, also check for sensitive data patterns
    if (this.config.strictMode) {
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(intent)) {
          const violation: SecurityViolation = {
            type: "sensitive_access",
            intent,
            pattern: pattern.source,
            timestamp: Date.now(),
          };
          this.recordViolation(violation);
          throw Errors.securityViolation(
            "Sensitive data reference detected in intent",
            intent
          );
        }
      }
    }
  }

  /**
   * Validates that AI output doesn't modify sensitive fields
   */
  validateStateChange<T extends object>(oldState: T, newState: T): void {
    for (const field of this.config.sensitiveFields) {
      const oldValue = this.getNestedValue(oldState, field);
      const newValue = this.getNestedValue(newState, field);

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        const violation: SecurityViolation = {
          type: "sensitive_access",
          intent: "[state change]",
          field,
          timestamp: Date.now(),
        };
        this.recordViolation(violation);
        throw Errors.securityViolation(
          `AI attempted to modify sensitive field: ${field}`,
          field
        );
      }
    }
  }

  /**
   * Sanitizes AI output by removing sensitive fields that shouldn't have changed
   */
  sanitizeOutput<T extends object>(oldState: T, newState: T): T {
    const sanitized = { ...newState } as T;

    for (const field of this.config.sensitiveFields) {
      const oldValue = this.getNestedValue(oldState, field);
      this.setNestedValue(sanitized, field, oldValue);
    }

    return sanitized;
  }

  /**
   * Gets the violation history
   */
  getViolations(): SecurityViolation[] {
    return [...this.violations];
  }

  /**
   * Clears violation history
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Adds sensitive fields to protect
   */
  addSensitiveFields(fields: string[]): void {
    this.config.sensitiveFields.push(...fields);
  }

  private recordViolation(violation: SecurityViolation): void {
    this.violations.push(violation);
    this.config.onViolation(violation);
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  private setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    const lastKey = keys.pop()!;
    const parent = keys.reduce((current, key) => {
      if (!(key in current)) current[key] = {};
      return current[key];
    }, obj);
    parent[lastKey] = value;
  }
}

/**
 * Creates a prompt guard with default settings
 */
export function createPromptGuard(config?: PromptGuardConfig): PromptGuard {
  return new PromptGuard(config);
}

/**
 * Quick check for obvious injection attempts
 * Returns true if the intent appears safe
 */
export function quickSafetyCheck(intent: string): boolean {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(intent)) {
      return false;
    }
  }
  return true;
}
