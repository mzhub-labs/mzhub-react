# @mzhub/react

**AI-Native State Management for React** — The "Redux for AI"

Manage application state through natural language intent. Synapse wraps AI providers (cloud and local) with safety, validation, and React integration.

## Installation

```bash
npm install @mzhub/react zod
```

### Optional Provider SDKs

Install only the SDKs for providers you plan to use:

```bash
# Local inference (browser-based)
npm install @xenova/transformers

# Groq (fast inference)
npm install groq-sdk

# Cerebras (wafer-scale)
npm install @cerebras/cerebras_cloud_sdk
```

## Quick Start

```tsx
import { SynapseProvider, useSemanticState } from "@mzhub/react";
import { z } from "zod";

// 1. Define your state schema
const TodoSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      done: z.boolean(),
    })
  ),
});

// 2. Wrap your app with the provider (use proxy, never raw API key!)
function App() {
  return (
    <SynapseProvider
      config={{
        proxy: { proxyUrl: "/api/ai" },
      }}
    >
      <TodoList />
    </SynapseProvider>
  );
}

// 3. Use natural language to manage state
function TodoList() {
  const [state, dispatch, meta] = useSemanticState({
    schema: TodoSchema,
    initialState: { items: [] },
  });

  return (
    <div>
      {meta.status === "GENERATING" && <p>Thinking...</p>}

      <button onClick={() => dispatch("Add buy groceries task")}>
        Add Task
      </button>

      <ul>
        {state.items.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Providers

Synapse supports multiple AI providers out of the box:

| Provider      | Factory                        | Models                     |
| ------------- | ------------------------------ | -------------------------- |
| **OpenAI**    | `createOpenAIProvider()`       | GPT-4, GPT-3.5, etc.       |
| **Anthropic** | `createAnthropicProvider()`    | Claude 3 Opus/Sonnet/Haiku |
| **Google**    | `createGeminiProvider()`       | Gemini Pro, Flash          |
| **Groq**      | `createGroqProvider()`         | Llama 3, Mixtral (fast)    |
| **Cerebras**  | `createCerebrasProvider()`     | Llama (wafer-scale)        |
| **Local**     | `createTransformersProvider()` | Any HuggingFace model      |
| **Hybrid**    | `createHybridProvider()`       | Cloud + local fallback     |

### Using Providers

```tsx
import { createProvider, createAnthropicProvider } from "@mzhub/react";

// Option 1: Factory pattern (dynamic)
const provider = createProvider({
  type: "anthropic",
  apiKey: process.env.ANTHROPIC_KEY,
  model: "claude-3-haiku-20240307",
});

// Option 2: Direct creation
const claude = createAnthropicProvider({
  apiKey: process.env.ANTHROPIC_KEY,
});

// Option 3: Local inference (no API key needed)
const local = createTransformersProvider({
  modelId: "Xenova/distilgpt2",
  task: "text-generation",
});
```

### Adding Custom Providers

```tsx
import { registerProvider } from "@mzhub/react";

registerProvider("my-llm", (config) => ({
  name: "my-llm",
  inference: async (prompt) => {
    const response = await fetch("/my-api", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    const data = await response.json();
    return { content: data.text };
  },
}));
```

## Security

Synapse is built with security first. See [SECURITY.md](./SECURITY.md) for details.

| Risk              | Mitigation                           |
| ----------------- | ------------------------------------ |
| Prompt Injection  | `PromptGuard` with pattern detection |
| XSS via AI Output | `sanitizeOutput()` strips HTML       |
| API Key Exposure  | Proxy enforcement, raw keys rejected |
| Infinite Retries  | Circuit breaker (max 3)              |
| Race Conditions   | AbortController cancellation         |
| GDPR              | `clearAllMemory()` API               |

### Rate Limiting

```tsx
import { createRateLimiter } from "@mzhub/react";

const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
});

if (limiter.check()) {
  await makeRequest();
}
```

## Context Management

Automatic token counting and semantic compression:

```tsx
import { createContextManager } from "@mzhub/react";

const context = createContextManager({
  maxTokens: 4096,
  compressionThreshold: 0.8,
  summarizationProvider: myProvider,
});

context.addMessage({ role: "user", content: "Hello" });

// When approaching limit, compress old messages
if (context.needsCompression()) {
  await context.compress();
}
```

## SSR Support

Hydration-safe hooks for Next.js:

```tsx
import { useSSRSemanticState } from "@mzhub/react";

function Component() {
  const { state, dispatch, hydrated } = useSSRSemanticState({
    schema: MySchema,
    initialState: { items: [] },
  });

  if (!hydrated) return <Skeleton />;
  return <div>{/* ... */}</div>;
}
```

## API Reference

### Hooks

| Hook                  | Purpose                     |
| --------------------- | --------------------------- |
| `useSemanticState`    | AI-powered state management |
| `useSSRSemanticState` | Hydration-safe version      |
| `useInference`        | One-off AI queries          |

### Components

| Component          | Purpose               |
| ------------------ | --------------------- |
| `<Infer>`          | Declarative inference |
| `<StreamingText>`  | Animated AI output    |
| `<ConfidenceGate>` | Confirmation UI       |

### Utilities

| Utility                  | Purpose          |
| ------------------------ | ---------------- |
| `sanitizeOutput()`       | Clean AI output  |
| `createPromptGuard()`    | Block injection  |
| `createRateLimiter()`    | API protection   |
| `createContextManager()` | Token management |
| `clearAllMemory()`       | GDPR compliance  |

## License

MIT

---

**DISCLAIMER**: Do not use Mzhub/React for financial, medical, or safety-critical decisions. AI output can be incorrect. The authors are not liable for damages arising from AI-generated content.
