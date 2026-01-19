/**
 * ConfidenceGate - UI component for confidence-based confirmations
 *
 * Renders different UI based on AI confidence level
 */

import React, { ReactNode, useState, useCallback } from "react";

export interface ConfidenceGateProps {
  /** Confidence score (0-1) */
  confidence: number;
  /** Threshold for automatic acceptance */
  threshold?: number;
  /** The pending change to confirm */
  pendingValue: unknown;
  /** Called when user confirms */
  onConfirm: () => void;
  /** Called when user rejects */
  onReject: () => void;
  /** Render content for high confidence (auto-accepted) */
  children: ReactNode;
  /** Render confirmation UI for low confidence */
  renderConfirmation?: (props: ConfirmationRenderProps) => ReactNode;
  /** Show confidence indicator */
  showConfidenceIndicator?: boolean;
}

export interface ConfirmationRenderProps {
  confidence: number;
  pendingValue: unknown;
  onConfirm: () => void;
  onReject: () => void;
  isDestructive: boolean;
}

/**
 * Default confirmation UI
 */
function DefaultConfirmation({
  confidence,
  pendingValue,
  onConfirm,
  onReject,
  isDestructive,
}: ConfirmationRenderProps): ReactNode {
  const confidencePercent = Math.round(confidence * 100);

  return (
    <div className="synapse-confirmation" role="alertdialog">
      <div className="synapse-confirmation-header">
        <span
          className="synapse-confidence-badge"
          data-level={
            confidence > 0.7 ? "high" : confidence > 0.4 ? "medium" : "low"
          }
        >
          {confidencePercent}% confident
        </span>
        {isDestructive && (
          <span className="synapse-destructive-badge">Destructive Change</span>
        )}
      </div>
      <div className="synapse-confirmation-body">
        <p>The AI wants to make the following change:</p>
        <pre className="synapse-change-preview">
          {typeof pendingValue === "string"
            ? pendingValue
            : JSON.stringify(pendingValue, null, 2)}
        </pre>
      </div>
      <div className="synapse-confirmation-actions">
        <button onClick={onReject} className="synapse-btn synapse-btn-cancel">
          Cancel
        </button>
        <button onClick={onConfirm} className="synapse-btn synapse-btn-confirm">
          Accept Change
        </button>
      </div>
    </div>
  );
}

/**
 * Confidence-based gate component
 *
 * @example
 * ```tsx
 * <ConfidenceGate
 *   confidence={meta.confidence}
 *   pendingValue={meta.pendingState}
 *   onConfirm={meta.confirmChange}
 *   onReject={meta.rejectChange}
 * >
 *   <TaskList items={state.items} />
 * </ConfidenceGate>
 * ```
 */
export function ConfidenceGate({
  confidence,
  threshold = 0.7,
  pendingValue,
  onConfirm,
  onReject,
  children,
  renderConfirmation = DefaultConfirmation,
  showConfidenceIndicator = false,
}: ConfidenceGateProps): ReactNode {
  const needsConfirmation = pendingValue !== null && pendingValue !== undefined;

  // Check if change appears destructive
  const isDestructive =
    typeof pendingValue === "object" && pendingValue !== null
      ? JSON.stringify(pendingValue).length < 10 && confidence < 0.5
      : false;

  if (needsConfirmation) {
    return (
      <>
        {renderConfirmation({
          confidence,
          pendingValue,
          onConfirm,
          onReject,
          isDestructive,
        })}
      </>
    );
  }

  return (
    <>
      {showConfidenceIndicator && (
        <div
          className="synapse-confidence-indicator"
          title={`AI Confidence: ${Math.round(confidence * 100)}%`}
          style={
            {
              "--confidence": String(confidence),
            } as React.CSSProperties
          }
        />
      )}
      {children}
    </>
  );
}

/**
 * Hook for manual confidence gating
 */
export function useConfidenceGate(threshold: number = 0.7) {
  const [pending, setPending] = useState<{
    value: unknown;
    confidence: number;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const gate = useCallback(
    async <T,>(
      value: T,
      confidence: number,
    ): Promise<{ accepted: boolean; value: T }> => {
      if (confidence >= threshold) {
        return { accepted: true, value };
      }

      return new Promise((resolve) => {
        setPending({
          value,
          confidence,
          resolve: (confirmed) => {
            setPending(null);
            resolve({ accepted: confirmed, value });
          },
        });
      });
    },
    [threshold],
  );

  const confirm = useCallback(() => {
    pending?.resolve(true);
  }, [pending]);

  const reject = useCallback(() => {
    pending?.resolve(false);
  }, [pending]);

  return {
    gate,
    pending: pending
      ? {
          value: pending.value,
          confidence: pending.confidence,
          confirm,
          reject,
        }
      : null,
  };
}
