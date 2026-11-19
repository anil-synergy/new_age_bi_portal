/**
 * Lists connectivity, session identity, and SELECT access on catalog tables.
 * Usage: node scripts/diagnose-db-tables.mjs [email]
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const portalRoot = join(__dirname, "..");

function loadEnvLocal() {
  const path = join(portalRoot, ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";

function poolConfig() {
  loadEnvLocal();
  let conn = process.env.BI_REPORT_DB_CONNECTION?.trim();
  if (!conn) {
    const filePath = process.env.BI_API_APPSETTINGS || DEFAULT_APPSETTINGS;
    const raw = readFileSync(filePath, "utf8");
    const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/);
    conn = match?.[1];
  }
  const map = {};
  for (const part of (conn || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return {
    host: process.env.BI_REPORT_DB_HOST || map.host,
    port: Number(process.env.BI_REPORT_DB_PORT || map.port || 5432),
    database:
      process.env.BI_REPORT_DB_NAME ||
      process.env.BI_REPORT_DATABASE ||
      map.database,
    user: process.env.BI_REPORT_DB_USER || map.username || map.user,
    password: process.env.BI_REPORT_DB_PASSWORD || map.password,
    ssl: { rejectUnauthorized: false },
  };
}

const CATALOG_TABLES = [
  "users",
  "role",
  "user_roles",
  "bi_report",
  "bi_report_categories",
  "bi_report_role_access",
  "bi_report_user_access",
];

const email = process.argv[2] || "";

const cfg = poolConfig();
console.log("=== BI Portal DB diagnostics ===\n");
console.log("Config (no password):");
console.log(`  host:     ${cfg.host}`);
console.log(`  port:     ${cfg.port}`);
console.log(`  database: ${cfg.database}`);
console.log(`  user:     ${cfg.user}`);
console.log(`  password: ${cfg.password ? "[set]" : "[MISSING]"}\n`);

const client = new pg.Client(cfg);

try {
  await client.connect();
  console.log("Connection: OK\n");

  const sess = await client.query(
    `SELECT current_user, session_user, current_database(), current_schema(), inet_server_addr()::text AS server_ip`
  );
  console.log("Session:", sess.rows[0]);

  const privs = await client.query(
    `SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
            has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage`
  );
  console.log("Privileges:", privs.rows[0], "\n");

  console.log("Table access (SELECT + row counts):");
  console.log("-".repeat(72));
  for (const table of CATALOG_TABLES) {
    let line = `  ${table.padEnd(28)}`;
    try {
      const exists = await client.query(
        `SELECT to_regclass($1) AS reg`,
        [`public.${table}`]
      );
      if (!exists.rows[0]?.reg) {
        console.log(line + "MISSING (table not in public schema)");
        continue;
      }
      const canSelect = await client.query(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') AS ok`,
        [`public.${table}`]
      );
      if (!canSelect.rows[0]?.ok) {
        console.log(line + "BLOCKED (no SELECT privilege)");
        continue;
      }
      const count = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      const active = await client.query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE is_active = true`
      ).catch(() => ({ rows: [{ n: "n/a" }] }));
      console.log(
        line +
          `OK  total=${count.rows[0].n}  active=${active.rows[0].n}`
      );
    } catch (e) {
      console.log(line + `ERROR: ${e.message}`);
    }
  }

  if (email) {
    console.log("\n" + "-".repeat(72));
    console.log(`Catalog simulation for: ${email}`);
    const userRes = await client.query(
      `SELECT id, name, email_address FROM users
       WHERE lower(trim(email_address)) = lower(trim($1)) AND is_active = true LIMIT 1`,
      [email]
    );
    if (!userRes.rows[0]) {
      console.log("  User NOT FOUND in users table (active). Menu will be empty — not a permission block.");
    } else {
      const u = userRes.rows[0];
      console.log("  User:", u.id, u.name, u.email_address);
      const rolesRes = await client.query(
        `SELECT r.name FROM user_roles ur JOIN role r ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND ur.is_active AND r.is_active`,
        [u.id]
      );
      const isSuperAdmin = rolesRes.rows.some((r) => r.name === "System Admin");
      console.log("  Roles:", rolesRes.rows.map((r) => r.name).join(", ") || "(none)");
      console.log("  System Admin:", isSuperAdmin);

      if (isSuperAdmin) {
        const r = await client.query(
          `SELECT COUNT(*)::int AS n FROM bi_report br WHERE br.is_active = true`
        );
        console.log(`  Super-admin report query: OK (${r.rows[0].n} active reports)`);
      } else {
        const r = await client.query(
          `SELECT COUNT(DISTINCT br.id)::int AS n
           FROM bi_report br
           LEFT JOIN bi_report_role_access ra ON ra.bi_report_id = br.id AND ra.is_active = true
           LEFT JOIN user_roles ur ON ur.role_id = ra.role_id AND ur.user_id = $1 AND ur.is_active = true
           LEFT JOIN bi_report_user_access ua ON ua.bi_report_id = br.id AND ua.user_id = $1 AND ua.is_active = true
           WHERE br.is_active = true AND (ur.user_id IS NOT NULL OR ua.user_id IS NOT NULL)`,
          [u.id]
        );
        console.log(`  Entitled reports (role/user access): ${r.rows[0].n}`);
      }
    }
  } else {
    console.log("\nTip: pass your sign-in email: node scripts/diagnose-db-tables.mjs you@synergyship.com");
  }

  console.log("\n=== Done ===");
} catch (e) {
  console.error("\nConnection FAILED:", e.message);
  if (e.code) console.error("  code:", e.code);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
