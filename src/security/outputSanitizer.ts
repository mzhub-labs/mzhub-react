/**
 * Output Sanitizer - Strips dangerous content from AI output
 *
 * Addresses:
 * - Indirect Prompt Injection (webpage trap)
 * - Data Exfiltration via image/script tags
 *
 * Rules:
 * 1. Never trust AI output to not contain HTML/scripts
 * 2. Block all external resource loading from AI content
 * 3. Whitelist only safe content patterns
 */

export interface SanitizerConfig {
  /** Allow safe inline formatting (bold, italic, etc) */
  allowBasicFormatting?: boolean;
  /** Allow code blocks */
  allowCodeBlocks?: boolean;
  /** Allow internal links (same origin) */
  allowInternalLinks?: boolean;
  /** Custom patterns to strip */
  customPatterns?: RegExp[];
  /** Called when dangerous content is detected */
  onDangerousContent?: (type: string, content: string) => void;
}

// Patterns that indicate dangerous content
const DANGEROUS_PATTERNS = {
  // Script injection
  scriptTags: /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  onEventHandlers: /\s+on\w+\s*=\s*["'][^"']*["']/gi,
  javascriptUrls: /javascript\s*:/gi,

  // Data exfiltration via external resources
  externalImages: /!\[([^\]]*)\]\(https?:\/\/[^)]+\)/gi,
  imgTags: /<img[^>]+src\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi,
  externalIframes: /<iframe[^>]+src\s*=\s*["'][^"']+["'][^>]*>/gi,

  // Style injection (can hide/overlay content)
  styleTags: /<style[\s\S]*?>[\s\S]*?<\/style>/gi,
  inlineStyles: /style\s*=\s*["'][^"']*["']/gi,

  // Form injection (phishing)
  formTags: /<form[\s\S]*?>[\s\S]*?<\/form>/gi,
  inputTags: /<input[^>]*>/gi,
  buttonTags: /<button[\s\S]*?>[\s\S]*?<\/button>/gi,

  // Link injection
  externalLinks: /<a[^>]+href\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi,

  // Base64 data (can embed malicious content)
  dataUrls: /data:[^,]+;base64,[a-zA-Z0-9+/=]+/gi,
};

// Safe patterns that should be preserved
const SAFE_PATTERNS = {
  // Basic markdown formatting
  bold: /\*\*([^*]+)\*\*/g,
  italic: /\*([^*]+)\*/g,
  inlineCode: /`([^`]+)`/g,

  // Code blocks (language-specific)
  codeBlock: /```[\w]*\n[\s\S]*?\n```/g,

  // Lists
  unorderedList: /^[\s]*[-*+]\s+.+$/gm,
  orderedList: /^[\s]*\d+\.\s+.+$/gm,
};

/**
 * Sanitizes AI output by removing dangerous patterns
 */
export function sanitizeOutput(
  content: string,
  config: SanitizerConfig = {}
): { sanitized: string; threats: string[] } {
  const {
    allowBasicFormatting = true,
    allowCodeBlocks = true,
    allowInternalLinks = false,
    customPatterns = [],
    onDangerousContent,
  } = config;

  let sanitized = content;
  const threats: string[] = [];

  // Remove all dangerous patterns
  for (const [name, pattern] of Object.entries(DANGEROUS_PATTERNS)) {
    const matches = sanitized.match(pattern);
    if (matches && matches.length > 0) {
      threats.push(name);
      onDangerousContent?.(name, matches[0]);
      sanitized = sanitized.replace(pattern, "[REMOVED]");
    }
  }

  // Apply custom patterns
  for (const pattern of customPatterns) {
    const matches = sanitized.match(pattern);
    if (matches && matches.length > 0) {
      threats.push("custom_pattern");
      sanitized = sanitized.replace(pattern, "[REMOVED]");
    }
  }

  // Strip all remaining HTML tags (conservative approach)
  sanitized = sanitized.replace(/<[^>]+>/g, "");

  return { sanitized, threats };
}

/**
 * Escapes HTML entities to prevent injection
 */
export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;",
  };

  return text.replace(/[&<>"'`=/]/g, (char) => escapeMap[char]);
}

/**
 * Validates that content is safe for rendering
 * Returns true if safe, throws if dangerous
 */
export function validateSafeContent(content: string): boolean {
  const { threats } = sanitizeOutput(content);

  if (threats.length > 0) {
    throw new Error(`Dangerous content detected: ${threats.join(", ")}`);
  }

  return true;
}

/**
 * Creates a safe text renderer that prevents XSS
 */
export function createSafeRenderer(config: SanitizerConfig = {}) {
  return (content: string): string => {
    const { sanitized } = sanitizeOutput(content, config);
    return escapeHtml(sanitized);
  };
}
