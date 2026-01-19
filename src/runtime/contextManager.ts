/**
 * Context Manager - Token counting and semantic compression
 *
 * Addresses the "Context Garbage Collector" pre-mortem risk:
 * - Tracks token count to prevent context overflow
 * - Automatically compresses old context when approaching limits
 * - Preserves semantic meaning during compression
 */

import { AIProvider } from "../providers/openai";

export interface ContextConfig {
  /** Maximum context length in tokens */
  maxTokens: number;
  /** Threshold to trigger compression (percentage of max) */
  compressionThreshold?: number;
  /** Provider to use for summarization */
  summarizationProvider?: AIProvider;
  /** Number of recent messages to preserve */
  preserveRecent?: number;
  /** Called when compression occurs */
  onCompress?: (original: number, compressed: number) => void;
}

export interface ContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp?: number;
  tokens?: number;
}

export interface ContextState {
  messages: ContextMessage[];
  totalTokens: number;
  compressedCount: number;
  systemPrompt?: string;
}

/**
 * Estimates token count for a string
 * Uses the 4-char approximation (good enough for most use cases)
 * For accuracy, use tiktoken library separately
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Average: 1 token ≈ 4 characters for English
  // Add 10% buffer for safety
  return Math.ceil((text.length / 4) * 1.1);
}

/**
 * More accurate token counting using word/punctuation boundaries
 */
export function countTokensDetailed(text: string): {
  estimated: number;
  words: number;
  characters: number;
} {
  const words = text.split(/\s+/).filter(Boolean).length;
  const characters = text.length;

  // Tokens are roughly: words + punctuation + special tokens
  // GPT models average about 0.75 tokens per word
  const estimated = Math.ceil(words * 1.3);

  return { estimated, words, characters };
}

/**
 * Create a context manager for conversation history
 */
export function createContextManager(config: ContextConfig): {
  addMessage: (message: Omit<ContextMessage, "tokens">) => void;
  setSystemPrompt: (prompt: string) => void;
  getMessages: () => ContextMessage[];
  getContext: () => string;
  getState: () => ContextState;
  compress: () => Promise<void>;
  clear: () => void;
  needsCompression: () => boolean;
  getTokenCount: () => number;
  getRemainingTokens: () => number;
} {
  const {
    maxTokens,
    compressionThreshold = 0.8,
    summarizationProvider,
    preserveRecent = 3,
    onCompress,
  } = config;

  let messages: ContextMessage[] = [];
  let systemPrompt: string | undefined;
  let compressedCount = 0;
  let cachedTotalTokens: number | null = null;

  function calculateTotalTokens(): number {
    if (cachedTotalTokens !== null) return cachedTotalTokens;

    let total = systemPrompt ? estimateTokens(systemPrompt) : 0;
    for (const msg of messages) {
      total += msg.tokens || estimateTokens(msg.content);
    }
    cachedTotalTokens = total;
    return total;
  }

  function invalidateCache() {
    cachedTotalTokens = null;
  }

  return {
    addMessage(message: Omit<ContextMessage, "tokens">) {
      const tokens = estimateTokens(message.content);
      messages.push({
        ...message,
        tokens,
        timestamp: message.timestamp || Date.now(),
      });
      invalidateCache();
    },

    setSystemPrompt(prompt: string) {
      systemPrompt = prompt;
      invalidateCache();
    },

    getMessages() {
      return [...messages];
    },

    getContext(): string {
      const parts: string[] = [];

      if (systemPrompt) {
        parts.push(`System: ${systemPrompt}`);
      }

      for (const msg of messages) {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        parts.push(`${role}: ${msg.content}`);
      }

      return parts.join("\n\n");
    },

    getState(): ContextState {
      return {
        messages: [...messages],
        totalTokens: calculateTotalTokens(),
        compressedCount,
        systemPrompt,
      };
    },

    needsCompression(): boolean {
      return calculateTotalTokens() >= maxTokens * compressionThreshold;
    },

    getTokenCount(): number {
      return calculateTotalTokens();
    },

    getRemainingTokens(): number {
      return maxTokens - calculateTotalTokens();
    },

    async compress(): Promise<void> {
      if (!summarizationProvider || messages.length <= preserveRecent) {
        return;
      }

      const originalTokens = calculateTotalTokens();

      // Split messages: old ones to compress, recent ones to keep
      const toCompress = messages.slice(0, -preserveRecent);
      const toKeep = messages.slice(-preserveRecent);

      if (toCompress.length === 0) return;

      // Build summary prompt
      const contextToSummarize = toCompress
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const summaryPrompt = `Summarize the following conversation context concisely, preserving key facts, decisions, and context needed for future responses. Be brief but complete.

CONVERSATION:
${contextToSummarize}

SUMMARY:`;

      try {
        const response = await summarizationProvider.inference(summaryPrompt, {
          maxTokens: Math.ceil(estimateTokens(contextToSummarize) / 3),
          temperature: 0.3,
        });

        // Replace old messages with summary
        const summaryMessage: ContextMessage = {
          role: "system",
          content: `[Previous context summary: ${response.content}]`,
          tokens: estimateTokens(response.content),
          timestamp: Date.now(),
        };

        messages = [summaryMessage, ...toKeep];
        compressedCount += toCompress.length;
        invalidateCache();

        const newTokens = calculateTotalTokens();
        onCompress?.(originalTokens, newTokens);
      } catch (error) {
        console.error("[Synapse] Context compression failed:", error);
        // Fall back to simple truncation
        messages = toKeep;
        compressedCount += toCompress.length;
        invalidateCache();
      }
    },

    clear() {
      messages = [];
      systemPrompt = undefined;
      compressedCount = 0;
      invalidateCache();
    },
  };
}

/**
 * Truncate context to fit within token limit (simple fallback)
 */
export function truncateContext(
  messages: ContextMessage[],
  maxTokens: number,
  preserveRecent: number = 2
): ContextMessage[] {
  const result: ContextMessage[] = [];
  let tokens = 0;

  // Always keep the most recent messages
  const recent = messages.slice(-preserveRecent);
  const older = messages.slice(0, -preserveRecent);

  // Add recent messages first (they're always included)
  for (const msg of recent) {
    const msgTokens = msg.tokens || estimateTokens(msg.content);
    tokens += msgTokens;
    result.unshift(msg);
  }

  // Add older messages from newest to oldest until limit
  for (let i = older.length - 1; i >= 0 && tokens < maxTokens; i--) {
    const msg = older[i];
    const msgTokens = msg.tokens || estimateTokens(msg.content);

    if (tokens + msgTokens <= maxTokens) {
      tokens += msgTokens;
      result.unshift(msg);
    } else {
      break;
    }
  }

  return result;
}

/**
 * Build a prompt with automatic context management
 */
export function buildManagedPrompt(
  systemPrompt: string,
  context: ContextMessage[],
  userMessage: string,
  maxTokens: number
): string {
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userMessage);
  const availableForContext = maxTokens - systemTokens - userTokens - 100; // Buffer

  const truncatedContext = truncateContext(context, availableForContext, 2);

  const parts = [systemPrompt];

  for (const msg of truncatedContext) {
    parts.push(`${msg.role}: ${msg.content}`);
  }

  parts.push(`user: ${userMessage}`);

  return parts.join("\n\n");
}
