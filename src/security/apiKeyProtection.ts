/**
 * API Key Protection - Prevents client-side key exposure
 *
 * Addresses: API Key Exposure risk
 *
 * Rules:
 * 1. Never allow raw API keys in client-side config
 * 2. Require a proxy callback function instead
 * 3. Validate that keys aren't accidentally exposed
 */

export interface ProxyConfig {
  /** URL of your backend proxy endpoint */
  proxyUrl: string;
  /** Optional custom headers */
  headers?: Record<string, string>;
  /** Optional request transformer */
  transformRequest?: (prompt: string) => unknown;
  /** Optional response transformer */
  transformResponse?: (response: unknown) => string;
}

export interface SecureProviderConfig {
  /** Use a proxy endpoint (recommended) */
  proxy?: ProxyConfig;
  /** Or provide a custom inference function */
  customInference?: (prompt: string) => Promise<string>;
}

// Pattern to detect API keys (common formats)
const API_KEY_PATTERNS = [
  /^sk-[a-zA-Z0-9]{48,}$/, // OpenAI
  /^sk-ant-[a-zA-Z0-9-]+$/, // Anthropic
  /^[a-zA-Z0-9]{32,}$/, // Generic long keys
  /^Bearer\s+[a-zA-Z0-9._-]+$/i, // Bearer tokens
];

/**
 * Validates that a value doesn't look like an API key
 * Throws if it appears to be an exposed key
 */
export function validateNotApiKey(value: string, fieldName: string): void {
  for (const pattern of API_KEY_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(
        `[Synapse Security] "${fieldName}" appears to be an API key. ` +
          `Never expose API keys in client-side code! ` +
          `Use a proxy endpoint or server-side function instead. ` +
          `See: https://synapse.dev/docs/security/api-keys`
      );
    }
  }
}

/**
 * Creates a secure inference function from proxy config
 */
export function createSecureInference(
  config: SecureProviderConfig
): (prompt: string) => Promise<string> {
  if (config.customInference) {
    return config.customInference;
  }

  if (!config.proxy) {
    throw new Error(
      "[Synapse Security] You must provide either a proxy config or customInference function. " +
        "Direct API keys are not allowed in client-side code."
    );
  }

  const {
    proxyUrl,
    headers = {},
    transformRequest,
    transformResponse,
  } = config.proxy;

  return async (prompt: string): Promise<string> => {
    const body = transformRequest ? transformRequest(prompt) : { prompt };

    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Proxy request failed: ${response.status}`);
    }

    const data = await response.json();

    return transformResponse
      ? transformResponse(data)
      : data.content || data.text || data.response || JSON.stringify(data);
  };
}

/**
 * Warns developers about security best practices
 */
export function logSecurityWarning(message: string): void {
  if (typeof console !== "undefined") {
    // Only log in development (check for common dev indicators)
    const isDev =
      typeof window !== "undefined" &&
      (window.location?.hostname === "localhost" ||
        window.location?.hostname === "127.0.0.1");
    if (isDev) {
      console.warn(`[Synapse Security] ${message}`);
    }
  }
}

/**
 * Security disclaimer for documentation
 */
export const SECURITY_DISCLAIMER = `
⚠️ SYNAPSE SECURITY NOTICE ⚠️

1. NEVER expose API keys in client-side code
2. Always use a proxy endpoint for paid AI APIs
3. AI-generated content is NOT sanitized by default
4. Use sanitizeOutput() before rendering AI content as HTML
5. Do NOT use useSemanticState for financial, medical, or safety-critical logic

The Synapse authors are NOT liable for:
- Data breaches from exposed API keys
- XSS attacks from unsanitized AI output
- Incorrect AI-generated advice or decisions
- Any financial, legal, or personal damages

See: https://synapse.dev/docs/security
`;
