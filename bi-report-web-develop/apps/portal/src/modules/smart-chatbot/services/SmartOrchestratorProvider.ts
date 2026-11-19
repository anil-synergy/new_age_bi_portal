import type { AgentStep, ChartPayload, ChatMessage, KpiPayload, MatrixPayload, NoteSpec, TablePayload } from "@/types";
import type { AIProvider, ChatOptions, SemanticModelContext } from "./types";

/** Thrown when the orchestrator cannot be used at all, so the caller may fall back to another provider. */
export class OrchestratorUnavailableError extends Error {}

interface NovaKpi {
  label: string;
  value: string | number;
  delta?: number | null;
}

interface NovaVisual {
  kind: "chart" | "kpi" | "table" | "matrix" | "none";
  title?: string;
  chart?: ChartPayload;
  kpi?: NovaKpi;
  kpis?: NovaKpi[];
  table?: TablePayload;
  matrix?: MatrixPayload;
}

interface OrchestratorMessage {
  content?: string;
  kind?: ChatMessage["kind"];
  confidence?: number;
  agents?: string[];
  query?: string;
  candidates?: string[];
  highlights?: string[];
  stats?: { label: string; value: string }[];
  table?: ChatMessage["table"];
  citations?: ChatMessage["citations"];
  assumptions?: string[];
  rlsUser?: string;
  visual?: NovaVisual;
  note?: NoteSpec;
  requestId?: string;
  elapsedMs?: number;
  needsReportContext?: boolean;
  openReportId?: string;
  cache?: { hit?: boolean };
  environment?: string;
}

function toKpi(kpi: NovaKpi): KpiPayload {
  const delta =
    typeof kpi.delta === "number" && Number.isFinite(kpi.delta)
      ? `${kpi.delta >= 0 ? "+" : ""}${kpi.delta.toLocaleString(undefined, { maximumFractionDigits: 2 })}% vs prior`
      : undefined;
  return { label: kpi.label, value: kpi.value, delta };
}

function toChatMessage(payload: OrchestratorMessage, trace: AgentStep[]): ChatMessage {
  const message: ChatMessage = {
    id: payload.requestId ?? crypto.randomUUID(),
    role: "assistant",
    content: payload.content ?? "",
    type: "text",
    kind: payload.kind,
    confidence: payload.confidence,
    agents: payload.agents,
    query: payload.query,
    candidates: payload.candidates,
    highlights: payload.highlights,
    stats: payload.stats,
    table: payload.table,
    citations: payload.citations,
    assumptions: payload.assumptions,
    rlsUser: payload.rlsUser,
    elapsedMs: payload.elapsedMs,
    agentTrace: trace,
    needsReportContext: payload.needsReportContext,
    openReportId: payload.openReportId,
    requestId: payload.requestId,
    cached: payload.cache?.hit === true,
    environment: payload.environment,
    note: payload.note,
  };

  const visual = payload.visual;
  if (visual?.kind === "chart" && visual.chart && (visual.chart.labels?.length || visual.chart.echartsOption)) {
    message.type = "chart";
    message.chartData = visual.chart;
  } else if (visual?.kind === "kpi" && visual.kpi) {
    message.type = "kpi";
    message.kpiData = toKpi(visual.kpi);
    if (visual.kpis && visual.kpis.length > 1) message.kpis = visual.kpis.map(toKpi);
  } else if (visual?.kind === "table") {
    message.type = "table";
    const table = visual.table ?? payload.table;
    if (table?.rows?.length) message.table = table;
  } else if (visual?.kind === "matrix" && visual.matrix) {
    message.type = "matrix";
    message.matrixData = visual.matrix;
  }
  return message;
}

function parseEvent(block: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export class SmartOrchestratorProvider implements AIProvider {
  constructor(private readonly endpoint = "/api/smart/chat") {}

  async chat(messages: ChatMessage[], context: SemanticModelContext, options: ChatOptions = {}): Promise<ChatMessage> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: last?.content ?? "",
          conversationId: context.conversationId,
          reportId: context.reportId,
          outputMode: "stream",
          memory: options.memory ?? [],
        }),
        signal: options.signal,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new OrchestratorUnavailableError("SMART orchestrator is unreachable");
    }

    if (response.status === 503) throw new OrchestratorUnavailableError("SMART orchestrator is not available");
    if (!response.ok || !response.body) {
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      return {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data?.message ?? `SMART request failed (${response.status}).`,
        kind: "error",
      };
    }

    const trace = new Map<string, AgentStep>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final: ChatMessage | null = null;

    let streamError: unknown = null;
    while (!final) {
      let value: Uint8Array | undefined;
      let done = false;
      try {
        ({ value, done } = await reader.read());
      } catch (error) {
        // The connection dropped mid-answer (proxy timeout, server restart). Report it as an answer, not a crash.
        streamError = error;
        break;
      }
      if (value) buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, "");
        const parsed = parseEvent(block);
        if (!parsed) continue;
        if (parsed.event === "delta") {
          const text = (parsed.data as { text?: string }).text;
          if (text) options.onDelta?.(text);
        } else if (parsed.event === "step") {
          const step = parsed.data as AgentStep;
          trace.set(step.step, step);
          options.onStep?.(step);
        } else if (parsed.event === "message") {
          final = toChatMessage(parsed.data as OrchestratorMessage, Array.from(trace.values()));
          break;
        }
      }
      if (done) break;
    }
    await reader.cancel().catch(() => undefined);
    if (!final && streamError) {
      console.error("SMART stream closed before the answer:", streamError);
      return {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "The connection to SMART closed before the answer arrived. Please send the question again.",
        kind: "error",
        agentTrace: Array.from(trace.values()),
      };
    }

    return (
      final ?? {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "SMART ended the response without an answer. Please try again.",
        kind: "error",
        agentTrace: Array.from(trace.values()),
      }
    );
  }
}
