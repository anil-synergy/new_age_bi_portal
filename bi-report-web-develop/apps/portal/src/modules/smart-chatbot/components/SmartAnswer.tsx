"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Bookmark, BookmarkCheck, PinOff, CheckCircle2, MinusCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { PencilIcon } from "@/modules/shared/components/animated-icons/PencilIcon";
import { ShieldAlertIcon } from "@/modules/shared/components/animated-icons/ShieldAlertIcon";
import { ShieldCheckIcon } from "@/modules/shared/components/animated-icons/ShieldCheckIcon";
import { ShieldIcon } from "@/modules/shared/components/animated-icons/ShieldIcon";
import { ShieldQuestionMarkIcon } from "@/modules/shared/components/animated-icons/ShieldQuestionMarkIcon";
import { AnswerProvenance, parseAnswerContent } from "./AnswerProvenance";
import { PinIcon } from "@/modules/shared/components/animated-icons/PinIcon";
import type { AgentStep, ChatMessage } from "@/types";
import { cn } from "@/lib/utils";
import { useVisualBox, type BoxVisual } from "@/modules/visual-box/visual-box";
import { NoteView } from "@/modules/visual-box/note-card";
import { VisualEditPrompt } from "@/modules/visual-box/VisualEditPrompt";
import { useSmartConversationOptional } from "../hooks/useSmartConversation";
import { ChatChart } from "./ChatChart";
import { ChatKpi } from "./ChatKpi";
import { ChatMatrixVisual, ChatTableVisual } from "./ChatDataVisual";
import { SteerWheelIndicator } from "./SteerWheelIndicator";

export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  return (
    <ol className="space-y-1" aria-label="Agent progress">
      {steps.map((s) => (
        <li key={s.step} className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {s.status === "running" ? (
            <SteerWheelIndicator animated size={14} className="gap-0" />
          ) : s.status === "skipped" ? (
            <MinusCircle className="h-3 w-3 text-slate-300" />
          ) : (
            <CheckCircle2 className="h-3 w-3 text-[var(--smart-accent)]" />
          )}
          <span>{s.label}</span>
          {s.agent && <span className="rounded bg-white px-1 text-[10px] text-slate-400">{s.agent}</span>}
          {typeof s.ms === "number" && <span className="ml-auto text-[10px] text-slate-400">{s.ms} ms</span>}
        </li>
      ))}
    </ol>
  );
}

function confidenceTier(pct: number, kind?: ChatMessage["kind"]): "low" | "caution" | "good" | "high" {
  const score = kind === "low_confidence" ? Math.min(pct, 50) : pct;
  if (score >= 96) return "high";
  if (score >= 51) return "good";
  if (score >= 26) return "caution";
  return "low";
}

function ConfidenceShield({ value, kind }: { value: number; kind?: ChatMessage["kind"] }) {
  const pct = Math.round(value * 100);
  const tier = confidenceTier(pct, kind);
  const color =
    tier === "high"
      ? "var(--smart-accent)"
      : tier === "good"
        ? "#3b82f6"
        : tier === "caution"
          ? "#d97706"
          : "#b45309";
  const aria =
    tier === "high"
      ? "High confidence"
      : tier === "good"
        ? "Good confidence"
        : tier === "caution"
          ? "Moderate confidence"
          : "Low confidence";

  const iconProps = { size: 18, color, className: "shrink-0", "aria-hidden": true as const };

  return (
    <span className="inline-flex" title={aria} role="img" aria-label={aria}>
      {tier === "high" && <ShieldCheckIcon {...iconProps} />}
      {tier === "good" && <ShieldIcon {...iconProps} />}
      {tier === "caution" && <ShieldAlertIcon {...iconProps} />}
      {tier === "low" && <ShieldQuestionMarkIcon {...iconProps} />}
    </span>
  );
}

function toBoxVisual(msg: ChatMessage): Omit<BoxVisual, "createdAt" | "onHome"> | null {
  if (msg.note) return { id: msg.id, title: msg.note.title.slice(0, 90), noteData: { text: msg.note.text, style: msg.note.style } };
  const title = (msg.content || "Visual").split("\n")[0].slice(0, 90);
  if (msg.type === "chart" && msg.chartData) return { id: msg.id, title, chartData: msg.chartData };
  if (msg.type === "kpi" && (msg.kpiData || msg.kpis?.length)) return { id: msg.id, title, kpiData: msg.kpiData, kpis: msg.kpis };
  if (msg.type === "table" && msg.table?.rows.length) return { id: msg.id, title, tableData: msg.table };
  if (msg.type === "matrix" && msg.matrixData) return { id: msg.id, title, matrixData: msg.matrixData };
  return null;
}

function findSourceQuestion(messages: ChatMessage[], assistantId: string) {
  const idx = messages.findIndex((m) => m.id === assistantId);
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return undefined;
}

function VisualActions({
  msg,
  visual,
  children,
}: {
  msg: ChatMessage;
  visual: Omit<BoxVisual, "createdAt" | "onHome"> | null;
  children: ReactNode;
}) {
  const box = useVisualBox();
  const smart = useSmartConversationOptional();
  const [editOpen, setEditOpen] = useState(false);
  const saved = box.items.find((item) => item.id === msg.id);
  const sourceQuestion = useMemo(
    () => (smart ? findSourceQuestion(smart.messages, msg.id) : undefined),
    [smart, msg.id],
  );
  const canEditChart = Boolean(visual?.chartData && smart?.openWithPrompt);

  if (!visual) return <>{children}</>;
  return (
    <div className="group/visual relative">
      {children}
      <div className="pointer-events-none absolute right-0 top-0 z-10 flex gap-0.5 opacity-0 group-hover/visual:pointer-events-auto group-hover/visual:opacity-100">
          <button
            type="button"
            aria-label={saved ? "Saved in Visual box" : "Save to Visual box"}
            title={saved ? "Saved in Visual box" : "Save to Visual box"}
            className="rounded-md bg-transparent p-1 text-[#333869] shadow-none hover:bg-transparent"
            onClick={() =>
              box.save({
                ...visual,
                onHome: saved?.onHome ?? false,
                sourceQuestion: sourceQuestion ?? saved?.sourceQuestion,
              })
            }
          >
            {saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
          </button>
          {canEditChart && (
            <button
              type="button"
              aria-label="Edit visual"
              title="Edit visual (regenerate in SMART)"
              className="rounded-md bg-transparent p-1 text-[#333869] shadow-none hover:bg-transparent"
              onClick={() => setEditOpen(true)}
            >
              <PencilIcon size={14} isAnimated color="#333869" />
            </button>
          )}
          {saved?.onHome ? (
            <button
              type="button"
              aria-label="Unpin from home"
              title="Unpin from home"
              className="rounded-md bg-transparent p-1 text-[#333869] shadow-none hover:bg-transparent"
              onClick={() => box.unpinHome(msg.id)}
            >
              <PinOff className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Pin to home"
              title="Pin to home"
              className="rounded-md bg-transparent p-1 text-[#333869] shadow-none hover:bg-transparent"
              onClick={() =>
                box.save({
                  ...visual,
                  onHome: true,
                  sourceQuestion: sourceQuestion ?? saved?.sourceQuestion,
                })
              }
            >
              <PinIcon size={14} className="portal-animated-icon" />
            </button>
          )}
      </div>
      <VisualEditPrompt
        open={editOpen}
        title={visual.title}
        contextQuestion={sourceQuestion}
        onClose={() => setEditOpen(false)}
        onSubmit={(prompt) => smart?.openWithPrompt(prompt)}
      />
    </div>
  );
}

const FEEDBACK_REASONS: { id: string; label: string }[] = [
  { id: "wrong_report", label: "Wrong report" },
  { id: "wrong_number", label: "Wrong number" },
  { id: "missing_data", label: "Missing data" },
  { id: "unclear", label: "Unclear" },
  { id: "slow", label: "Too slow" },
  { id: "other", label: "Other" },
];

async function sendFeedback(requestId: string, rating: "up" | "down", reason?: string, comment?: string) {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const response = await fetch("/api/smart/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ requestId, rating, reason, comment }),
  });
  return response.ok;
}

function FeedbackBar({ requestId }: { requestId: string }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const submit = async (value: "up" | "down", why?: string, note?: string) => {
    setStatus("saving");
    setStatus((await sendFeedback(requestId, value, why, note)) ? "saved" : "failed");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[10px] text-slate-500">
        <span>Was this helpful?</span>
        <button
          type="button"
          aria-label="Helpful"
          title="Helpful"
          className={cn("rounded p-0.5 hover:bg-slate-100", rating === "up" && "text-[var(--smart-accent)]")}
          onClick={() => {
            setRating("up");
            void submit("up");
          }}
        >
          <ThumbsUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          title="Not helpful"
          className={cn("rounded p-0.5 hover:bg-slate-100", rating === "down" && "text-rose-600")}
          onClick={() => {
            setRating("down");
            setStatus("idle");
          }}
        >
          <ThumbsDown className="h-3 w-3" />
        </button>
        {status === "saved" && <span className="text-[var(--smart-accent)]">Thanks</span>}
        {status === "failed" && <span className="text-rose-600">Could not save</span>}
      </div>
      {rating === "down" && status !== "saved" && (
        <div className="space-y-1.5 rounded-md border bg-white p-2">
          <div className="flex flex-wrap gap-1">
            {FEEDBACK_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px]",
                  reason === r.id ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
                onClick={() => setReason(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 1000))}
            placeholder="What should the answer have been? (optional)"
            rows={2}
            className="w-full resize-none rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[var(--smart-border)]"
          />
          <button
            type="button"
            disabled={status === "saving"}
            className="rounded bg-[#333869] px-2 py-0.5 text-[10px] text-white disabled:opacity-50"
            onClick={() => void submit("down", reason, comment.trim() || undefined)}
          >
            {status === "saving" ? "Sending…" : "Send feedback"}
          </button>
        </div>
      )}
    </div>
  );
}

export type SmartAnswerPart = "all" | "body" | "after";

export function SmartAnswer({
  msg,
  onPick,
  part = "all",
}: {
  msg: ChatMessage;
  onPick?: (text: string) => void;
  part?: SmartAnswerPart;
}) {
  const visual = toBoxVisual(msg);
  const hasVisual = Boolean(visual);
  const showTable =
    !hasVisual &&
    msg.type !== "kpi" &&
    msg.type !== "table" &&
    msg.type !== "matrix" &&
    !!msg.table?.rows.length &&
    (msg.table?.rows.length ?? 0) > 1;
  const showConfidence = typeof msg.confidence === "number" && msg.kind !== "error";
  const { body: answerBody, sourceLabel } = parseAnswerContent(msg.content || "");

  const body = (
    <div className="space-y-2.5">
      {answerBody && <p className="whitespace-pre-line">{answerBody}</p>}

      {!hasVisual && !!msg.stats?.length && msg.stats.length > 1 && (
        <div className="grid grid-cols-2 gap-1.5">
          {msg.stats.map((s) => (
            <div key={s.label} className="rounded-md border bg-white px-2 py-1.5">
              <p className="truncate text-[10px] uppercase tracking-wide text-slate-500" title={s.label}>{s.label}</p>
              <p className="truncate text-sm font-semibold text-[#333869]" title={s.value}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {msg.note && (
        <VisualActions msg={msg} visual={visual}>
          <NoteView text={msg.note.text} style={msg.note.style} />
        </VisualActions>
      )}
      {msg.type === "chart" && msg.chartData && (
        <VisualActions msg={msg} visual={visual}>
          <ChatChart data={msg.chartData} />
        </VisualActions>
      )}
      {msg.type === "kpi" && (
        <VisualActions msg={msg} visual={visual}>
          {msg.kpis?.length ? (
            <div className="grid grid-cols-1 gap-1.5">{msg.kpis.map((k) => <ChatKpi key={k.label} data={k} />)}</div>
          ) : (
            msg.kpiData && <ChatKpi data={msg.kpiData} />
          )}
        </VisualActions>
      )}

      {msg.type === "table" && msg.table && (
        <VisualActions msg={msg} visual={visual}>
          <ChatTableVisual table={msg.table} />
        </VisualActions>
      )}
      {msg.type === "matrix" && msg.matrixData && (
        <VisualActions msg={msg} visual={visual}>
          <ChatMatrixVisual matrix={msg.matrixData} />
        </VisualActions>
      )}

      {showTable && msg.table && <ChatTableVisual table={msg.table} />}

      {!!msg.candidates?.length && (
        <div className="flex flex-wrap gap-1.5">
          {msg.candidates.map((c) => (
            <button
              key={c}
              type="button"
              className="rounded-full border border-[var(--smart-border)] bg-white px-2 py-0.5 text-[11px] text-[var(--smart-accent)] hover:bg-[color-mix(in_srgb,var(--smart-accent)_8%,white)]"
              onClick={() => onPick?.(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const after = (
    <div className="space-y-1.5">
      {showConfidence && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ConfidenceShield value={msg.confidence ?? 0} kind={msg.kind} />
        </div>
      )}
      <AnswerProvenance msg={msg} sourceLabel={sourceLabel} />
      {msg.requestId && msg.kind !== "error" && <FeedbackBar requestId={msg.requestId} />}
    </div>
  );

  if (part === "body") return body;
  if (part === "after") return after;
  return (
  <div className="space-y-2">
      {body}
      {after}
    </div>
  );
}
