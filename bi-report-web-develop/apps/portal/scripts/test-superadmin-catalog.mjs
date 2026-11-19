import { readFileSync } from "fs";
import pg from "pg";

const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";

function clientConfig() {
  const raw = readFileSync(DEFAULT_APPSETTINGS, "utf8");
  const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/)[1];
  const map = {};
  for (const part of match.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return {
    host: map.host,
    port: 5432,
    database: process.env.BI_REPORT_DATABASE || map.database,
    user: map.username,
    password: map.password,
    ssl: { rejectUnauthorized: false },
  };
}

const client = new pg.Client(clientConfig());
await client.connect();
const r = await client.query(`
  SELECT br.id, br.name, br.rls_role_mapping
  FROM bi_report br
  WHERE br.is_active = true
`);
let bad = 0;
for (const row of r.rows) {
  const raw = row.rls_role_mapping;
  if (raw == null) continue;
  if (typeof raw === "object") {
    const m = raw.RoleMappings ?? raw.roleMappings;
    if (m != null && !Array.isArray(m)) bad++;
    continue;
  }
  bad++;
  console.log("non-object rls", row.id, typeof raw);
}
console.log("total", r.rows.length, "bad", bad);
await client.end();
