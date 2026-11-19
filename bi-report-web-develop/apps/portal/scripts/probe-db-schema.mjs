import { readFileSync } from "fs";
import pg from "pg";

const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";

function parseNpgsql(connectionString) {
  const map = {};
  for (const part of connectionString.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    map[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return {
    host: map.host,
    port: Number(map.port || 5432),
    database: map.database,
    user: map.username || map.user,
    password: map.password,
    ssl: { rejectUnauthorized: false },
  };
}

const raw = readFileSync(DEFAULT_APPSETTINGS, "utf8");
const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/);
const client = new pg.Client(parseNpgsql(match[1]));

await client.connect();
const who = await client.query("SELECT current_user, current_database(), current_schema()");
console.log("session:", who.rows[0]);

for (const table of ["users", "bi_report", "role", "user_roles"]) {
  try {
    const total = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    const active = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE is_active = true`);
    console.log(`${table}: total=${total.rows[0].n} active=${active.rows[0].n}`);
  } catch (e) {
    console.log(`${table}: ERROR ${e.message}`);
  }
}

const schemas = await client.query(`
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_name IN ('users','bi_report','role')
  ORDER BY table_schema, table_name
`);
console.log("table locations:", schemas.rows);

const sample = await client.query(`SELECT email_address, is_active FROM users LIMIT 5`).catch((e) => ({ rows: [], error: e.message }));
if (sample.error) console.log("users sample error:", sample.error);
else console.log("users sample:", sample.rows);

const dbs = await client.query(`SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`).catch((e) => ({ rows: [], error: e.message }));
if (dbs.error) console.log("databases error:", dbs.error);
else console.log("databases:", dbs.rows.map((r) => r.datname).join(", "));

await client.end();
