import type { ChatMessage } from "@/types";

/** Client-side split between inline bubble vs full SMART panel. */
export function isComplexSmartReply(msg: ChatMessage): boolean {
  if (msg.type === "chart" || msg.type === "kpi") return true;
  if (msg.table?.rows && msg.table.rows.length > 1) return true;
  if (msg.kpis && msg.kpis.length > 1) return true;
  if (msg.kind === "clarification" && (msg.candidates?.length ?? 0) > 2) return true;
  const lines = msg.content.split("\n").filter((line) => line.trim()).length;
  if (lines > 2 || msg.content.length > 220) return true;
  return false;
}

export function looksLikeSmartQuestion(query: string): boolean {
  const t = query.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  return /^(what|how|why|when|where|who|show|tell|list|count|total|average|sum|which|explain|compare)\b/i.test(t);
}
