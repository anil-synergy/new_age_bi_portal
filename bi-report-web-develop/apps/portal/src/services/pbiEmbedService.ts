import type { EmbedTokenRequest, EmbedTokenResponse, PageMeta } from "@/types";

function authHeader(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const data = raw ? (JSON.parse(raw) as { message?: string; error?: string }) : {};
    return data.message || data.error || raw.slice(0, 300) || response.statusText;
  } catch {
    return raw.slice(0, 300) || response.statusText;
  }
}

const inflightEmbedTokens = new Map<string, Promise<EmbedTokenResponse>>();

function embedRequestKey(request: EmbedTokenRequest): string {
  return JSON.stringify({
    workspaceId: request.workspaceId,
    reportId: request.reportId,
    catalogId: request.catalogId,
    datasetId: request.datasetId,
    embedType: request.embedType,
    pageName: request.pageName,
    visualName: request.visualName,
    username: request.username ?? request.effectiveIdentity?.username,
    roles: request.roles ?? request.effectiveIdentity?.roles,
    skipIdentity: request.skipIdentity,
  });
}

/** Browser entry: the Azure Function itself is called only from /api/embed on the server. */
export async function fetchEmbedToken(request: EmbedTokenRequest): Promise<EmbedTokenResponse> {
  const key = embedRequestKey(request);
  const existing = inflightEmbedTokens.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const response = await fetch("/api/embed/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(await readError(response));
    return (await response.json()) as EmbedTokenResponse;
  })().finally(() => {
    inflightEmbedTokens.delete(key);
  });

  inflightEmbedTokens.set(key, pending);
  return pending;
}

export async function fetchReportPages(workspaceId: string, reportId: string): Promise<PageMeta[]> {
  const params = new URLSearchParams({ workspaceId, reportId });
  const response = await fetch(`/api/embed/pages?${params}`, { headers: authHeader() });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return (data.pages ?? data) as PageMeta[];
}

export async function fetchSemanticModel(workspaceId: string, reportId: string, datasetId?: string) {
  const params = new URLSearchParams({ workspaceId, reportId });
  if (datasetId) params.set("datasetId", datasetId);
  const response = await fetch(`/api/embed/semantic-model?${params}`, { headers: authHeader() });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return data.model ?? data;
}

export async function executeDaxQuery(
  workspaceId: string,
  datasetId: string,
  daxQuery: string,
  effectiveIdentity?: { username: string; roles: string[] }
) {
  const response = await fetch("/api/embed/dax", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ workspaceId, datasetId, daxQuery, effectiveIdentity }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return data.results ?? data;
}
