import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight check: is the portal wired to SMART and is the orchestrator up? */
export async function GET() {
  const url = process.env.SMART_ORCHESTRATOR_URL?.replace(/\/+$/, "");
  const configured = Boolean(url && process.env.SMART_ORCHESTRATOR_SECRET);

  if (!configured) {
    return NextResponse.json({
      configured: false,
      orchestratorReachable: false,
      ready: false,
      message: "Set SMART_ORCHESTRATOR_URL and SMART_ORCHESTRATOR_SECRET in .env.local, then restart npm run dev.",
    });
  }

  let orchestratorReachable = false;
  let ready = false;
  let checks: Record<string, unknown> | undefined;
  let semantiqReachable = false;
  let semantiqReady = false;

  try {
    const response = await fetch(`${url}/health/ready`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    orchestratorReachable = response.ok || response.status === 503;
    if (response.ok || response.status === 503) {
      const body = (await response.json()) as { status?: string; checks?: Record<string, unknown> };
      ready = body.status === "ready";
      checks = body.checks;
    }
  } catch {
    orchestratorReachable = false;
  }

  try {
    const semUrl = `${url}/mcp/semantiq/health/ready`;
    const sem = await fetch(semUrl, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    semantiqReachable = sem.ok || sem.status === 503;
    if (sem.ok || sem.status === 503) {
      const body = (await sem.json()) as { status?: string };
      semantiqReady = body.status === "ready";
    }
  } catch {
    semantiqReachable = false;
  }

  return NextResponse.json({
    configured: true,
    orchestratorReachable,
    ready,
    semantiqReachable,
    semantiqReady,
    checks,
    message: !orchestratorReachable
      ? "SMART orchestrator is not running. Restart npm run dev (agents auto-start) or run npm run smart:agents."
      : !semantiqReachable
        ? "SemantIQ is not reachable on the unified SMART stack. Check the dev terminal for [SMART] errors."
        : !ready
          ? "Orchestrator is up but not ready (check LLM key, MCP agents, and SemantIQ Power BI credentials in .env.local)."
          : !semantiqReady
            ? "SemantIQ is up but Power BI credentials failed (SMART_PBI_CLIENT_ID / SMART_PBI_CLIENT_SECRET / tenant)."
            : "SMART is connected and ready.",
  });
}
