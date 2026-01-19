# Security Policy

## Overview

Synapse is built with security as a core principle. This document outlines the security mitigations implemented in the library and best practices for developers.

## Risk Register & Mitigations

### 1. Security Risks

#### A. Indirect Prompt Injection

**Risk**: Malicious text processed by AI contains hidden instructions that cause harmful output.

**Mitigation**: `PromptGuard` (`src/security/promptGuard.ts`)

- Pattern-based injection detection
- Blocks "ignore instructions", "pretend to be", "system prompt" extraction attempts
- Records violations for audit

```ts
import { createPromptGuard } from "@mzhub/react";

const guard = createPromptGuard();
guard.validateIntent(userInput); // Throws on injection attempt
```

---

#### B. Data Exfiltration via Hallucination

**Risk**: AI generates markdown images or external resources that leak data to attacker servers.

**Mitigation**: `sanitizeOutput()` (`src/security/outputSanitizer.ts`)

- Strips all HTML tags (`<script>`, `<iframe>`, etc.)
- Removes `javascript:` URLs
- Blocks external image references
- Removes `data:` URLs
- Strips event handlers (`onclick`, etc.)

```ts
import { sanitizeOutput } from "@mzhub/react";

const { sanitized, threats } = sanitizeOutput(aiResponse);
// threats: ['scriptTags', 'externalImages', ...]
```

---

#### C. API Key Exposure

**Risk**: Developers accidentally expose API keys in client-side code.

**Mitigation**: `apiKeyProtection.ts`

- `validateNotApiKey()` - Detects and blocks API key patterns
- `createSecureInference()` - Enforces proxy architecture
- Runtime warnings in development mode

```ts
// ❌ BLOCKED - Raw keys rejected
<SynapseProvider config={{ apiKey: 'sk-...' }}>

// ✅ REQUIRED - Use proxy
<SynapseProvider config={{ proxy: { proxyUrl: '/api/ai' } }}>
```

---

### 2. Logic & Architectural Risks

#### D. Hydration Mismatch (SSR)

**Risk**: Server and client render different AI outputs, causing React hydration errors.

**Mitigation**: `ssrHooks.ts`

- `useSSRSemanticState` - Renders `initialState` on server
- AI inference runs only in `useEffect` (client-side)
- Deterministic first render, then progressive enhancement

```ts
const { state, hydrated } = useSSRSemanticState({
  schema: MySchema,
  initialState: { items: [] }, // Server renders this
});

if (!hydrated) return <Skeleton />;
```

---

#### E. Infinite Loop / Wallet Drain

**Risk**: Validation failures trigger endless retry loops, draining API credits.

**Mitigation**: Circuit Breaker in `selfCorrection.ts`

- Maximum 3 retries by default
- Configurable via `maxRetries`
- Graceful failure with error state

```ts
const result = await executeWithCorrection({
  prompt,
  schema,
  inference,
  config: { maxRetries: 3 }, // Hard limit
});
```

---

#### F. Race Conditions

**Risk**: Multiple rapid dispatches cause out-of-order state updates.

**Mitigation**: AbortController in `useSemanticState.ts`

- Previous pending requests are cancelled
- Only the latest intent is processed
- State machine ensures linear progression

---

### 3. Ecosystem Risks

#### G. Scraper Protection (Future)

**Risk**: Semantic Tree APIs could be abused by scrapers.

**Mitigation**: Rate Limiter (`src/security/rateLimiter.ts`)

- Fixed window limiter
- Token bucket for burst control
- Sliding window for accuracy

```ts
import { createRateLimiter } from "@mzhub/react";

const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000,
});

if (!limiter.check()) {
  throw new Error("Rate limited");
}
```

---

#### H. Model Version Decay

**Risk**: Model updates break application behavior.

**Mitigation**: `modelManifest.ts`

- SHA-256 hash verification
- Version pinning
- Cache validation before use

---

### 4. Compliance

#### I. GDPR Right to be Forgotten

**Risk**: User data persists in IndexedDB/Vector stores after deletion request.

**Mitigation**: `memoryManager.ts`

- `clearAllMemory()` - Wipes all Synapse data
- `registerClearDataHandler()` - Custom cleanup hooks
- Clears: IndexedDB, Cache API, localStorage

```ts
import { clearAllMemory } from "@mzhub/react";

await clearAllMemory(); // Complete data removal
```

---

#### J. Liability Disclaimer

**Mitigation**: Explicit disclaimers in code and documentation.

```ts
import { SECURITY_DISCLAIMER } from "@mzhub/react";
// "Do not use for financial, medical, or safety-critical decisions..."
```

---

## Security Checklist for Developers

Before deploying, ensure:

- [ ] Never pass raw API keys to `SynapseProvider`
- [ ] Always use `sanitizeOutput()` before rendering AI text as HTML
- [ ] Use `useSSRSemanticState` for Next.js/SSR apps
- [ ] Set reasonable `maxRetries` for self-correction
- [ ] Implement `clearAllMemory()` for GDPR compliance
- [ ] Add rate limiting to any exposed endpoints
- [ ] Display appropriate disclaimers for AI-generated content

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please email [security contact] with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact

Do NOT open public issues for security vulnerabilities.

---

## Version

This document applies to `@mzhub/react` v0.1.0+
