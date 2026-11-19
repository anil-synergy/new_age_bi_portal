import { NextResponse } from "next/server";
import { getDevDbPool } from "@/lib/catalog/dev-db";

const READY_TIMEOUT_MS = 5_000;

/** Path segments after /api/bi/ (e.g. bi-report-api/v1/ping). */
export function isBiHealthPath(path: string[]): boolean {
  if (path.length < 3) return false;
  if (path[0] !== "bi-report-api" || path[1] !== "v1") return false;
  const rest = path.slice(2).join("/");
  return rest === "ping" || rest === "health" || rest === "health/ready";
}

function livenessBody(): string {
  const at = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `BI Portal (Next.js) received your request at => ${at}`;
}

async function checkCatalogDatabase(): Promise<boolean> {
  const pool = getDevDbPool();
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), READY_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Handles ping, health, and health/ready without calling bi-report-api. */
export async function handleBiHealth(path: string[]): Promise<NextResponse> {
  const suffix = path.slice(2).join("/");
  if (suffix === "ping" || suffix === "health") {
    return new NextResponse(livenessBody(), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (suffix === "health/ready") {
    const ok = await checkCatalogDatabase();
    return new NextResponse(ok ? "Healthy" : "Unhealthy", {
      status: ok ? 200 : 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({ message: "Not found" }, { status: 404 });
}
