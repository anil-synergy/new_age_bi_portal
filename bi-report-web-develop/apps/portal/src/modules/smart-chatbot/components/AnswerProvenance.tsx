"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ChatMessage } from "@/types";
import { cn } from "@/lib/utils";

const SOURCE_SUFFIX = /\n\n\(Source:\s*(.+)\)\s*$/;

export function parseAnswerContent(content: string): { body: string; sourceLabel: string | null } {
  const match = content.match(SOURCE_SUFFIX);
  if (!match || match.index === undefined) return { body: content, sourceLabel: null };
  return { body: content.slice(0, match.index).trimEnd(), sourceLabel: match[1].trim() };
}

function hasProvenance(msg: ChatMessage, sourceLabel: string | null): boolean {
  return Boolean(
    sourceLabel ||
      msg.citations?.length ||
      msg.query ||
      msg.assumptions?.length ||
      msg.agents?.length ||
      msg.rlsUser ||
      msg.cached ||
      (msg.environment && msg.environment !== "PROD"),
  );
}

export function AnswerProvenance({ msg, sourceLabel }: { msg: ChatMessage; sourceLabel: string | null }) {
  const [open, setOpen] = useState(false);
  if (!hasProvenance(msg, sourceLabel)) return null;

  const summary = sourceLabel ? `Source: ${sourceLabel}` : "How this was retrieved";

  return (
    <div className="text-[11px]">
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-md py-0.5 text-left text-[var(--smart-muted)] hover:text-[var(--smart-text)]"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
        <span className="truncate">{summary}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-md border border-[var(--smart-border)] bg-[color-mix(in_srgb,var(--smart-bubble-assistant)_70%,transparent)] px-2.5 py-2 text-[var(--smart-text)]">
          {sourceLabel && (
            <p>
              <span className="font-medium text-[var(--smart-muted)]">Report / model </span>
              {sourceLabel}
            </p>
          )}
          {msg.agents?.length ? (
            <p>
              <span className="font-medium text-[var(--smart-muted)]">Agents </span>
              {msg.agents.join(", ")}
            </p>
          ) : null}
          {msg.cached && (
            <p>
              <span className="font-medium text-[var(--smart-muted)]">Cache </span>
              Recent identical query (same data refresh window)
            </p>
          )}
          {msg.environment && msg.environment !== "PROD" && (
            <p>
              <span className="font-medium text-[var(--smart-muted)]">Environment </span>
              {msg.environment === "ARCHIVE" ? "Archived model" : "Draft / test model"}
            </p>
          )}
          {msg.rlsUser && (
            <p>
              <span className="font-medium text-[var(--smart-muted)]">Row-level security </span>
              Applied for signed-in user
            </p>
          )}
          {!!msg.assumptions?.length && (
            <div>
              <p className="font-medium text-[var(--smart-muted)]">Assumptions</p>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                {msg.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {!!msg.citations?.length && (
            <div>
              <p className="font-medium text-[var(--smart-muted)]">Fields referenced</p>
              <ul className="mt-0.5 space-y-0.5">
                {msg.citations.map((c, i) => (
                  <li key={`${c.kind}-${c.name}-${i}`} className="font-mono text-[10px]">
                    {c.table ? `${c.table}[${c.name}]` : c.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {msg.query && (
            <div>
              <p className="font-medium text-[var(--smart-muted)]">Query executed</p>
              <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-white/60 p-1.5 font-mono text-[10px] dark:bg-black/20">
                {msg.query}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}