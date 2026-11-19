import "server-only";

function semantiqBaseUrl(): string | null {
  const direct = process.env.SEMANTIQ_HTTP_URL?.replace(/\/+$/, "");
  if (direct) return direct;
  const orchestrator = process.env.SMART_ORCHESTRATOR_URL?.replace(/\/+$/, "");
  if (orchestrator) return `${orchestrator}/mcp/semantiq`;
  return null;
}

function authHeaders(): HeadersInit {
  const secret = process.env.SMART_ORCHESTRATOR_SECRET || process.env.MCP_SHARED_SECRET;
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

export async function callSemanticMetadataSync(mode: "full" | "incremental") {
  const base = semantiqBaseUrl();
  if (!base) {
    return { status: "error", message: "Set SEMANTIQ_HTTP_URL or SMART_ORCHESTRATOR_URL" };
  }
  const response = await fetch(`${base}/admin/semantic-metadata/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ mode }),
    cache: "no-store",
    signal: AbortSignal.timeout(600_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}

export async function fetchSemanticMetadataStatus() {
  const base = semantiqBaseUrl();
  if (!base) {
    return { status: "error", message: "Set SEMANTIQ_HTTP_URL or SMART_ORCHESTRATOR_URL" };
  }
  const response = await fetch(`${base}/admin/semantic-metadata/status`, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}
