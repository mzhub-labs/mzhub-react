/**
 * Rate Limiter - Protection against abuse and scraping
 *
 * Provides client-side rate limiting for:
 * - Semantic tree API access
 * - Inference requests
 * - Any endpoint that could be abused
 */

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** What to do when limit is exceeded */
  onLimitExceeded?: (info: RateLimitInfo) => void;
  /** Unique identifier for this limiter */
  key?: string;
}

export interface RateLimitInfo {
  /** Current request count in window */
  current: number;
  /** Maximum allowed */
  limit: number;
  /** Milliseconds until window resets */
  resetIn: number;
  /** Whether request was blocked */
  blocked: boolean;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// Global storage for rate limit state
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Creates a rate limiter instance
 *
 * @example
 * ```ts
 * const limiter = createRateLimiter({
 *   maxRequests: 10,
 *   windowMs: 60000, // 1 minute
 *   onLimitExceeded: (info) => {
 *     console.warn(`Rate limited! Reset in ${info.resetIn}ms`);
 *   }
 * });
 *
 * // Before making a request
 * if (limiter.check()) {
 *   await makeRequest();
 * }
 * ```
 */
export function createRateLimiter(config: RateLimitConfig): {
  check: () => boolean;
  consume: () => RateLimitInfo;
  getInfo: () => RateLimitInfo;
  reset: () => void;
} {
  const { maxRequests, windowMs, onLimitExceeded, key = "default" } = config;

  function getEntry(): RateLimitEntry {
    const now = Date.now();
    let entry = rateLimitStore.get(key);

    // Create new window if none exists or window expired
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      rateLimitStore.set(key, entry);
    }

    return entry;
  }

  function getInfo(): RateLimitInfo {
    const entry = getEntry();
    const now = Date.now();
    const resetIn = Math.max(0, windowMs - (now - entry.windowStart));

    return {
      current: entry.count,
      limit: maxRequests,
      resetIn,
      blocked: entry.count >= maxRequests,
    };
  }

  return {
    /** Check if request would be allowed (doesn't consume) */
    check(): boolean {
      const entry = getEntry();
      return entry.count < maxRequests;
    },

    /** Consume a request slot, returns info about the limit */
    consume(): RateLimitInfo {
      const entry = getEntry();
      const wasBlocked = entry.count >= maxRequests;

      if (!wasBlocked) {
        entry.count++;
      }

      const info = getInfo();

      if (wasBlocked && onLimitExceeded) {
        onLimitExceeded(info);
      }

      return info;
    },

    /** Get current rate limit info without consuming */
    getInfo,

    /** Reset the rate limiter */
    reset(): void {
      rateLimitStore.delete(key);
    },
  };
}

/**
 * Token bucket rate limiter for smoother rate limiting
 * Allows bursts while maintaining average rate
 */
export interface TokenBucketConfig {
  /** Maximum tokens (burst capacity) */
  bucketSize: number;
  /** Tokens added per second */
  refillRate: number;
  /** Unique identifier */
  key?: string;
}

interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

const tokenBuckets = new Map<string, TokenBucketState>();

export function createTokenBucket(config: TokenBucketConfig): {
  consume: (tokens?: number) => boolean;
  getTokens: () => number;
  reset: () => void;
} {
  const { bucketSize, refillRate, key = "default-bucket" } = config;

  function getState(): TokenBucketState {
    let state = tokenBuckets.get(key);

    if (!state) {
      state = { tokens: bucketSize, lastRefill: Date.now() };
      tokenBuckets.set(key, state);
    }

    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsed = (now - state.lastRefill) / 1000;
    const tokensToAdd = elapsed * refillRate;

    state.tokens = Math.min(bucketSize, state.tokens + tokensToAdd);
    state.lastRefill = now;

    return state;
  }

  return {
    /** Consume tokens, returns true if successful */
    consume(tokens = 1): boolean {
      const state = getState();

      if (state.tokens >= tokens) {
        state.tokens -= tokens;
        return true;
      }

      return false;
    },

    /** Get current token count */
    getTokens(): number {
      return getState().tokens;
    },

    /** Reset bucket to full */
    reset(): void {
      tokenBuckets.set(key, { tokens: bucketSize, lastRefill: Date.now() });
    },
  };
}

/**
 * Sliding window rate limiter for more accurate limiting
 */
export interface SlidingWindowConfig {
  /** Maximum requests in window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Unique identifier */
  key?: string;
}

const slidingWindows = new Map<string, number[]>();

export function createSlidingWindowLimiter(config: SlidingWindowConfig): {
  check: () => boolean;
  consume: () => boolean;
  getRequestCount: () => number;
  reset: () => void;
} {
  const { maxRequests, windowMs, key = "sliding-default" } = config;

  function cleanOldRequests(): number[] {
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = slidingWindows.get(key) || [];
    timestamps = timestamps.filter((t) => t > cutoff);
    slidingWindows.set(key, timestamps);

    return timestamps;
  }

  return {
    check(): boolean {
      const timestamps = cleanOldRequests();
      return timestamps.length < maxRequests;
    },

    consume(): boolean {
      const timestamps = cleanOldRequests();

      if (timestamps.length < maxRequests) {
        timestamps.push(Date.now());
        slidingWindows.set(key, timestamps);
        return true;
      }

      return false;
    },

    getRequestCount(): number {
      return cleanOldRequests().length;
    },

    reset(): void {
      slidingWindows.delete(key);
    },
  };
}

/**
 * Decorator for rate-limited functions
 */
export function withRateLimit<
  T extends (...args: unknown[]) => Promise<unknown>
>(fn: T, config: RateLimitConfig): T {
  const limiter = createRateLimiter(config);

  return (async (...args: Parameters<T>) => {
    const info = limiter.consume();

    if (info.blocked) {
      throw new Error(
        `Rate limit exceeded. Try again in ${Math.ceil(
          info.resetIn / 1000
        )} seconds.`
      );
    }

    return fn(...args);
  }) as T;
}

/**
 * Clear all rate limit state (useful for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
  tokenBuckets.clear();
  slidingWindows.clear();
}
