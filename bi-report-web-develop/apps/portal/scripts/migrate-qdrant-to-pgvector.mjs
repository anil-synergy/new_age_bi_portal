/**
 * One-off copy of the SemantIQ keyword vectors from Qdrant (collection smart_keywords) into
 * the pgvector table public.semantic_keyword_embeddings in database bi_semantiq.
 *
 * - Vectors are copied as stored (384-dim); nothing is re-embedded.
 * - Idempotent: rows are upserted by the Qdrant point id, so re-running is safe.
 * - Creates the new objects from migrate-semantic-keywords-pgvector.sql first (unless --dry-run).
 *
 * Env:
 *   QDRANT_URL, QDRANT_API_KEY      (read from the agent's .env; never printed)
 *   QDRANT_COLLECTION               default smart_keywords
 *   BI_API_APPSETTINGS              API appsettings file holding BIReportDbConnection (same host/user)
 *   BI_SEMANTIQ_DATABASE            default bi_semantiq
 *
 * Run:
 *   node scripts/migrate-qdrant-to-pgvector.mjs --dry-run
 *   node scripts/migrate-qdrant-to-pgvector.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const DDL_FILE = join(here, "migrate-semantic-keywords-pgvector.sql");
const DEFAULT_APPSETTINGS =
  "C:\\Users\\anilkumar.c\\OneDrive - Synergy Maritime Private Limited\\WIP\\BI Portal Revamp\\bi-report-api-develop\\bi-report-api-develop\\PowerBi\\PowerBI.Api\\appsettings.Development.json";
const BATCH = 500;
const PAGE = 256;
const DIMS = 384;
const dryRun = process.argv.includes("--dry-run");

function parseNpgsql(cs) {
  const map = {};
  for (const part of cs.split(";")) {
    const i = part.indexOf("=");
    if (i !== -1) map[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return { host: map.host, port: Number(map.port || 5432), user: map.username || map.user, password: map.password };
}

function loadDbTarget() {
  const raw = readFileSync(process.env.BI_API_APPSETTINGS || DEFAULT_APPSETTINGS, "utf8");
  const match = raw.match(/"BIReportDbConnection"\s*:\s*"([^"]+)"/);
  if (!match?.[1]) throw new Error("BIReportDbConnection not found in the API appsettings file");
  return { ...parseNpgsql(match[1]), database: process.env.BI_SEMANTIQ_DATABASE || "bi_semantiq" };
}

async function qdrant(path, body) {
  const base = process.env.QDRANT_URL?.replace(/\/+$/, "");
  if (!base) throw new Error("QDRANT_URL is not set");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant ${path} failed with HTTP ${res.status}`);
  return res.json();
}

async function* scrollAll(collection) {
  let offset = null;
  do {
    const body = { limit: PAGE, with_payload: true, with_vector: true };
    if (offset !== null) body.offset = offset;
    const data = await qdrant(`/collections/${collection}/points/scroll`, body);
    const result = data.result ?? {};
    for (const p of result.points ?? []) yield p;
    offset = result.next_page_offset ?? null;
  } while (offset !== null);
}

function toRow(p) {
  const payload = p.payload ?? {};
  const vector = Array.isArray(p.vector) ? p.vector : null;
  if (!vector || vector.length !== DIMS) throw new Error(`point ${p.id} has no ${DIMS}-dim vector`);
  const reportIds = Array.isArray(payload.report_ids) ? payload.report_ids : payload.report_ids ? [payload.report_ids] : [];
  return {
    id: String(p.id),
    object_kind: String(payload.object_kind ?? "unknown"),
    keyword: String(payload.keyword ?? ""),
    measure_name: payload.measure_name ?? null,
    table_name: payload.table_name ?? null,
    dataset_id: String(payload.dataset_id ?? "").toLowerCase(),
    workspace_id: payload.workspace_id ?? null,
    report_ids: JSON.stringify(reportIds),
    description: payload.description ?? null,
    payload: JSON.stringify(payload),
    embedding: `[${vector.join(",")}]`,
  };
}

async function insertBatch(client, rows) {
  const cols = ["id", "object_kind", "keyword", "measure_name", "table_name", "dataset_id", "workspace_id", "report_ids", "description", "payload", "embedding"];
  const params = [];
  const tuples = rows.map((r, row) => {
    const at = cols.map((c, col) => {
      params.push(r[c]);
      const n = row * cols.length + col + 1;
      return c === "embedding" ? `$${n}::vector` : c === "report_ids" || c === "payload" ? `$${n}::jsonb` : c === "id" ? `$${n}::uuid` : `$${n}`;
    });
    return `(${at.join(",")})`;
  });
  await client.query(
    `INSERT INTO public.semantic_keyword_embeddings (${cols.join(",")}) VALUES ${tuples.join(",")}
     ON CONFLICT (id) DO UPDATE SET object_kind = EXCLUDED.object_kind, keyword = EXCLUDED.keyword,
       measure_name = EXCLUDED.measure_name, table_name = EXCLUDED.table_name, dataset_id = EXCLUDED.dataset_id,
       workspace_id = EXCLUDED.workspace_id, report_ids = EXCLUDED.report_ids, description = EXCLUDED.description,
       payload = EXCLUDED.payload, embedding = EXCLUDED.embedding, updated_at = now()`,
    params,
  );
}

async function main() {
  const collection = process.env.QDRANT_COLLECTION || "smart_keywords";
  const info = await qdrant(`/collections/${collection}`, {}).catch(() => null);
  const expected = info?.result?.points_count ?? null;
  console.log(`Qdrant collection ${collection}: points_count=${expected ?? "unknown"}`);

  const target = loadDbTarget();
  const client = new pg.Client({ ...target, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await client.connect();
  console.log(`Connected to ${target.database} on ${target.host} as ${target.user}`);

  if (!dryRun) {
    await client.query(readFileSync(DDL_FILE, "utf8"));
    console.log("DDL applied (new table, HNSW index, filter indexes).");
  }

  let read = 0;
  let written = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    if (!dryRun) await insertBatch(client, batch);
    written += batch.length;
    batch = [];
  };

  for await (const point of scrollAll(collection)) {
    read += 1;
    batch.push(toRow(point));
    if (batch.length >= BATCH) {
      await flush();
      if (written % 5000 < BATCH) console.log(`  ${dryRun ? "checked" : "written"} ${written}`);
    }
  }
  await flush();
  console.log(`${dryRun ? "Dry run: read" : "Read"} ${read} points from Qdrant, ${dryRun ? "would write" : "wrote"} ${written}.`);

  if (!dryRun) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n, count(DISTINCT dataset_id)::int AS datasets,
              count(*) FILTER (WHERE object_kind = 'value')::int AS values_rows,
              count(*) FILTER (WHERE vector_dims(embedding) <> ${DIMS})::int AS bad_dims
       FROM public.semantic_keyword_embeddings`,
    );
    console.log("Verification:", JSON.stringify(rows[0]));
    if (expected !== null && rows[0].n !== expected) {
      console.warn(`WARNING: table has ${rows[0].n} rows but Qdrant reported ${expected}. Re-run to finish, then compare.`);
    } else if (expected !== null) {
      console.log("Row count matches Qdrant points_count.");
    }
  }
  await client.end();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
