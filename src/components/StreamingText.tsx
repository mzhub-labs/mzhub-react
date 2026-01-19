/**
 * StreamingText - Renders AI text with token-by-token animation
 *
 * Security: All tokens are sanitized before rendering
 */

import React, { useState, useEffect, useRef, ReactNode } from "react";
import { sanitizeOutput, escapeHtml } from "../security";

export interface StreamingTextProps {
  /** The text to display (can be partial during streaming) */
  text: string;
  /** Whether currently streaming */
  isStreaming?: boolean;
  /** Typing speed in ms per character (0 = instant) */
  typingSpeed?: number;
  /** Custom cursor element */
  cursor?: ReactNode;
  /** Called when animation completes */
  onComplete?: () => void;
  className?: string;
  as?: React.ElementType;
  /** Disable sanitization (DANGEROUS) */
  dangerouslyDisableSanitization?: boolean;
}

/**
 * Animated streaming text component
 *
 * @example
 * ```tsx
 * <StreamingText
 *   text={aiResponse}
 *   isStreaming={isLoading}
 *   typingSpeed={20}
 * />
 * ```
 */
export function StreamingText({
  text,
  isStreaming = false,
  typingSpeed = 0,
  cursor = "▊",
  onComplete,
  className,
  as: Component = "span",
  dangerouslyDisableSanitization = false,
}: StreamingTextProps): ReactNode {
  const [displayedText, setDisplayedText] = useState("");
  const [showCursor, setShowCursor] = useState(isStreaming);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetTextRef = useRef(text);

  // Sanitize input
  const sanitizedText = dangerouslyDisableSanitization
    ? text
    : sanitizeOutput(text).sanitized;

  useEffect(() => {
    targetTextRef.current = sanitizedText;

    if (typingSpeed === 0) {
      // Instant display
      setDisplayedText(sanitizedText);
      if (!isStreaming) {
        setShowCursor(false);
        onComplete?.();
      }
      return;
    }

    // Animate typing
    const animate = () => {
      setDisplayedText((current) => {
        if (current.length < targetTextRef.current.length) {
          return targetTextRef.current.slice(0, current.length + 1);
        }
        return current;
      });

      if (displayedText.length < sanitizedText.length) {
        animationRef.current = setTimeout(animate, typingSpeed);
      } else if (!isStreaming) {
        setShowCursor(false);
        onComplete?.();
      }
    };

    animationRef.current = setTimeout(animate, typingSpeed);

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [sanitizedText, typingSpeed, isStreaming, onComplete]);

  // Show cursor while streaming
  useEffect(() => {
    setShowCursor(isStreaming);
  }, [isStreaming]);

  return (
    <Component className={className}>
      {displayedText}
      {showCursor && <span className="synapse-cursor">{cursor}</span>}
    </Component>
  );
}

/**
 * Hook for streaming text with sanitization
 */
export function useStreamingText(
  text: string,
  isStreaming: boolean,
  options: { sanitize?: boolean } = {},
): { displayedText: string; isComplete: boolean } {
  const { sanitize = true } = options;
  const [displayedText, setDisplayedText] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    const sanitized = sanitize ? sanitizeOutput(text).sanitized : text;
    setDisplayedText(sanitized);
    setIsComplete(!isStreaming && sanitized === text);
  }, [text, isStreaming, sanitize]);

  return { displayedText, isComplete };
}
