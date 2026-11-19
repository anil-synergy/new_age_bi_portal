import { readFileSync } from "fs";
import pg from "pg";

const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";

function cfg() {
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

const email = process.argv[2] || "aadesh.shah@synergyship.com";
const client = new pg.Client(cfg());
await client.connect();

const user = await client.query(
  `SELECT id, email_address FROM users WHERE lower(trim(email_address))=lower(trim($1)) AND is_active=true LIMIT 1`,
  [email]
);
console.log("user", user.rows[0]);
if (!user.rows[0]) process.exit(0);

const uid = user.rows[0].id;
const roles = await client.query(
  `SELECT r.name FROM user_roles ur JOIN role r ON r.id=ur.role_id WHERE ur.user_id=$1 AND ur.is_active AND r.is_active`,
  [uid]
);
const isSuperAdmin = roles.rows.some((r) => r.name === "System Admin");
console.log("isSuperAdmin", isSuperAdmin, "roles", roles.rows.map((r) => r.name));

try {
  if (isSuperAdmin) {
    await client.query(`SELECT br.id FROM bi_report br WHERE br.is_active=true LIMIT 5`);
    console.log("super admin query OK");
  } else {
    const sql = `
      SELECT DISTINCT ON (br.id) br.id, br.name
      FROM bi_report br
      LEFT JOIN bi_report_role_access ra ON ra.bi_report_id = br.id AND ra.is_active = true
      LEFT JOIN user_roles ur ON ur.role_id = ra.role_id AND ur.user_id = $1 AND ur.is_active = true
      LEFT JOIN bi_report_user_access ua ON ua.bi_report_id = br.id AND ua.user_id = $1 AND ua.is_active = true
      WHERE br.is_active = true AND (ur.user_id IS NOT NULL OR ua.user_id IS NOT NULL)
      ORDER BY br.id LIMIT 5`;
    const r = await client.query(sql, [uid]);
    console.log("user report query OK", r.rows.length, "rows");
  }
} catch (e) {
  console.error("QUERY FAIL", e.message);
}

await client.end();
