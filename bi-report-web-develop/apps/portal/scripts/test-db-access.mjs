/**
 * Quick connectivity test for synergy_bi_reports_dev (from bi-report-api appsettings.Development.json).
 * Run: node scripts/test-db-access.mjs
 */
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
    connectionTimeoutMillis: 10000,
  };
}

function loadConnectionString() {
  if (process.env.BI_REPORT_DB_CONNECTION?.trim()) {
    return process.env.BI_REPORT_DB_CONNECTION.trim();
  }
  const filePath = process.env.BI_API_APPSETTINGS || DEFAULT_APPSETTINGS;
  const raw = readFileSync(filePath, "utf8");
  const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("BIReportDbConnection not found in appsettings.Development.json");
  }
  return match[1];
}

async function main() {
  const connStr = loadConnectionString();
  const cfg = parseNpgsql(connStr);
  if (process.env.BI_REPORT_DATABASE?.trim()) {
    cfg.database = process.env.BI_REPORT_DATABASE.trim();
  }

  console.log("=== BI Portal Dev DB Access Test ===");
  console.log(`Host:     ${cfg.host}`);
  console.log(`Port:     ${cfg.port}`);
  console.log(`Database: ${cfg.database}`);
  console.log(`User:     ${cfg.user}`);
  console.log("Connecting...\n");

  const client = new pg.Client(cfg);
  const started = Date.now();

  try {
    await client.connect();
    console.log(`OK  Connected in ${Date.now() - started}ms`);

    const version = await client.query("SELECT version()");
    console.log(`OK  PostgreSQL: ${version.rows[0].version.split(",")[0]}`);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE is_active = true) AS active_users,
        (SELECT COUNT(*)::int FROM bi_report WHERE is_active = true) AS active_reports,
        (SELECT COUNT(*)::int FROM role WHERE is_active = true) AS active_roles
    `);
    const row = counts.rows[0];
    console.log(`OK  Active users:   ${row.active_users}`);
    console.log(`OK  Active reports: ${row.active_reports}`);
    console.log(`OK  Active roles:   ${row.active_roles}`);

    const sampleUser = await client.query(`
      SELECT email_address, name
      FROM users
      WHERE is_active = true
      ORDER BY name
      LIMIT 3
    `);
    if (sampleUser.rows.length) {
      console.log("\nSample users (first 3):");
      for (const u of sampleUser.rows) {
        console.log(`  - ${u.name} <${u.email_address}>`);
      }
    }

    console.log("\n=== RESULT: DATABASE ACCESS OK ===");
    process.exit(0);
  } catch (error) {
    console.error(`FAIL  ${error.message}`);
    if (error.code) console.error(`      code: ${error.code}`);
    if (String(error.message).includes("ETIMEDOUT")) {
      console.error("\nHint: RDS may require VPN or an IP allowlist entry for your machine.");
    }
    console.log("\n=== RESULT: DATABASE ACCESS FAILED ===");
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
