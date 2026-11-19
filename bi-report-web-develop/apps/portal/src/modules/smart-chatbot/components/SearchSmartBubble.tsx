"use client";

import type { ChatMessage } from "@/types";
import { Button } from "@/modules/shared/components/ui/button";
import { SteerWheelIndicator } from "./SteerWheelIndicator";
import { isComplexSmartReply } from "../logic/smartReplyHeuristic";

/** First sentence of the reply, one line: the quick answer shown in the search bubble. */
function oneLiner(text: string): string {
  const first = text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const sentence = first.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? first;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

interface SearchSmartBubbleProps {
  anchor: DOMRect;
  latest?: ChatMessage;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onOpenPanel: () => void;
  onFollowUp: (text: string) => void;
}

export function SearchSmartBubble({
  anchor,
  latest,
  loading,
  error,
  onClose,
  onOpenPanel,
  onFollowUp,
}: SearchSmartBubbleProps) {
  const complex = latest && !loading && isComplexSmartReply(latest);

  return (
    <div
      className="smart-panel fixed z-[100002] max-w-md rounded-xl border border-[var(--smart-border)] bg-[var(--smart-bg)] p-3 text-[var(--smart-text)] shadow-xl"
      style={{ top: anchor.bottom + 6, left: anchor.left, width: Math.max(anchor.width, 320) }}
      role="dialog"
      aria-label="SMART quick answer"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {loading && (
        <div className="py-1">
          <SteerWheelIndicator animated label="Thinking…" labelClassName="text-[11px] text-[var(--smart-muted)]" />
        </div>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
      {!loading && latest && complex && (
        <div className="space-y-2 text-sm">
          <p>This needs a visual, a KPI or a detailed analysis. Click here to open SMART in the side panel.</p>
          <Button type="button" size="sm" className="smart-accent-btn" onClick={onOpenPanel}>
            Click here to open SMART
          </Button>
        </div>
      )}
      {!loading && latest && !complex && (
        <div className="space-y-1 rounded-lg bg-[var(--smart-bubble-assistant)] p-2 text-sm text-[var(--smart-text)]">
          <p className="truncate" title={oneLiner(latest.content)}>{oneLiner(latest.content)}</p>
          {latest.kind === "error" || latest.kind === "low_confidence" ? null : (
            <button
              type="button"
              className="text-[11px] text-[var(--smart-muted)] underline-offset-2 hover:underline"
              onClick={onOpenPanel}
            >
              Click here to continue in SMART
            </button>
          )}
        </div>
      )}
    </div>
  );
}
