import { readFileSync } from "fs";
import { Pool, type PoolConfig } from "pg";

const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";

function loadConnectionString(): string {
  if (process.env.BI_REPORT_DB_CONNECTION?.trim()) {
    return process.env.BI_REPORT_DB_CONNECTION.trim();
  }

  const filePath = process.env.BI_API_APPSETTINGS || DEFAULT_APPSETTINGS;
  const raw = readFileSync(filePath, "utf8");
  const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("BIReportDbConnection was not found in appsettings.Development.json");
  }
  return match[1];
}

function parseNpgsql(connectionString: string): PoolConfig {
  const map: Record<string, string> = {};
  for (const part of connectionString.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    map[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }

  const database =
    process.env.BI_REPORT_DB_NAME?.trim() ||
    process.env.BI_REPORT_DATABASE?.trim() ||
    map.database;

  return {
    host: process.env.BI_REPORT_DB_HOST?.trim() || map.host,
    port: Number(process.env.BI_REPORT_DB_PORT?.trim() || map.port || 5432),
    database,
    user: process.env.BI_REPORT_DB_USER?.trim() || map.username || map.user,
    password: process.env.BI_REPORT_DB_PASSWORD?.trim() || map.password,
    ssl: { rejectUnauthorized: false },
    max: 6,
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 30000,
  };
}

let pool: Pool | null = null;
let poolSignature: string | null = null;

function poolSignatureFrom(cfg: PoolConfig): string {
  return `${cfg.host}:${cfg.port}/${cfg.database}:${cfg.user}`;
}

export function getDevDbPool(): Pool {
  const cfg = parseNpgsql(loadConnectionString());
  const signature = poolSignatureFrom(cfg);

  if (!pool || poolSignature !== signature) {
    if (pool) {
      pool.end().catch(() => {});
    }
    pool = new Pool(cfg);
    poolSignature = signature;
    pool.on("error", () => {
      pool?.end().catch(() => {});
      pool = null;
      poolSignature = null;
    });
  }

  return pool;
}

export function getDevDbMeta() {
  const cfg = parseNpgsql(loadConnectionString());
  return { host: cfg.host, database: cfg.database, port: cfg.port, user: cfg.user };
}
