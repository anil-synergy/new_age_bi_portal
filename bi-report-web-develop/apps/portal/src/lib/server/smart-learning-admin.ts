import "server-only";
import { SignJWT } from "jose";

function orchestratorBase(): string | null {
  return process.env.SMART_ORCHESTRATOR_URL?.replace(/\/+$/, "") ?? null;
}

async function portalToken(email: string): Promise<string | null> {
  const secret = process.env.SMART_ORCHESTRATOR_SECRET;
  if (!secret) return null;
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("bi-portal")
    .setAudience("smart-orchestrator")
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(new TextEncoder().encode(secret));
}

export async function fetchLearningProposals(email: string) {
  const base = orchestratorBase();
  if (!base) return { status: "error", message: "SMART_ORCHESTRATOR_URL not configured" };
  const token = await portalToken(email);
  if (!token) return { status: "error", message: "SMART_ORCHESTRATOR_SECRET not configured" };
  const response = await fetch(`${base}/learning/proposals`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}

export async function generateLearningProposal(email: string) {
  const base = orchestratorBase();
  if (!base) return { status: "error", message: "SMART_ORCHESTRATOR_URL not configured" };
  const token = await portalToken(email);
  if (!token) return { status: "error", message: "SMART_ORCHESTRATOR_SECRET not configured" };
  const response = await fetch(`${base}/learning/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}

export async function applyLearningProposal(email: string, proposalId: string) {
  const base = orchestratorBase();
  if (!base) return { status: "error", message: "SMART_ORCHESTRATOR_URL not configured" };
  const token = await portalToken(email);
  if (!token) return { status: "error", message: "SMART_ORCHESTRATOR_SECRET not configured" };
  const response = await fetch(`${base}/learning/proposals/${encodeURIComponent(proposalId)}/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(300_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}

export async function rejectLearningProposal(email: string, proposalId: string, reason: string) {
  const base = orchestratorBase();
  if (!base) return { status: "error", message: "SMART_ORCHESTRATOR_URL not configured" };
  const token = await portalToken(email);
  if (!token) return { status: "error", message: "SMART_ORCHESTRATOR_SECRET not configured" };
  const response = await fetch(`${base}/learning/proposals/${encodeURIComponent(proposalId)}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { httpStatus: response.status, ...body };
}