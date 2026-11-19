"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function VisualEditPrompt({
  open,
  title,
  contextQuestion,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  contextQuestion?: string;
  onClose: () => void;
  onSubmit: (composedPrompt: string) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) setDraft("");
  }, [open, title]);

  if (!open) return null;

  const commit = () => {
    const extra = draft.trim();
    if (!extra) return;
    const parts = [
      `Update the visual "${title}".`,
      contextQuestion ? `Original data question: ${contextQuestion}.` : null,
      extra,
      "Regenerate the DAX query and chart visual accordingly.",
    ].filter(Boolean);
    onSubmit(parts.join(" "));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Edit visual"
        className={cn(
          "w-full max-w-md rounded-xl border border-white/30 bg-white/95 p-4 shadow-2xl backdrop-blur-md",
          "dark:border-white/15 dark:bg-slate-900/95",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title={title} onClose={onClose} />
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Describe color, chart type, or layout changes. SMART will rerun SemantIQ and N.O.V.A.
        </p>
        <textarea
          value={draft}
          autoFocus
          rows={4}
          placeholder='e.g. Use a pie chart with teal and orange colors; show labels on each slice'
          className="mt-3 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#333869] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!draft.trim()}
            className="rounded-lg bg-[#333869] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            onClick={commit}
          >
            Regenerate in SMART
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-[#333869] dark:text-white">Edit visual</h3>
        <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{title}</p>
      </div>
      <button type="button" aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100" onClick={onClose}>
        <X className="h-4 w-4" />
      </button>
    </header>
  );
}