import { readFileSync } from "fs";
import pg from "pg";

const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";

function baseConfig() {
  const raw = readFileSync(DEFAULT_APPSETTINGS, "utf8");
  const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/);
  const map = {};
  for (const part of match[1].split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    map[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return {
    host: map.host,
    port: Number(map.port || 5432),
    user: map.username || map.user,
    password: map.password,
    ssl: { rejectUnauthorized: false },
  };
}

async function counts(database) {
  const client = new pg.Client({ ...baseConfig(), database });
  await client.connect();
  const users = await client.query("SELECT COUNT(*)::int AS n FROM users");
  const reports = await client.query("SELECT COUNT(*)::int AS n FROM bi_report");
  const sample = await client.query(
    "SELECT email_address FROM users WHERE is_active = true ORDER BY email_address LIMIT 3"
  );
  await client.end();
  return { users: users.rows[0].n, reports: reports.rows[0].n, sample: sample.rows };
}

for (const db of ["synergy_bi_reports_dev", "synergy_bi_reports"]) {
  try {
    const c = await counts(db);
    console.log(db, c);
  } catch (e) {
    console.log(db, "ERROR", e.message);
  }
}
