import type { NextRequest } from "next/server";
import type { AdminContext } from "./bi-admin-auth";
import type { CatalogUserContext } from "./bi-admin-auth";
import {
  auditUserJson,
  EMPTY_GUID,
  getDb,
  jsonOk,
  readJsonBody,
  softDeleteRow,
  UUID_RE,
} from "./bi-admin-common";
import { ensurePhase6Tables } from "./bi-admin-schema";
import type { DisplayReport, TileConfig } from "@/types";

type DisplayRow = {
  id: string;
  name: string;
  description: string | null;
  canvas_width: number;
  canvas_height: number;
  tiles: TileConfig[] | null;
  category_id: string | null;
};

function rowToDisplay(row: DisplayRow): DisplayReport {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    tiles: Array.isArray(row.tiles) ? row.tiles : [],
    categoryId: row.category_id ?? undefined,
  };
}

export async function listDisplayReports(): Promise<DisplayReport[]> {
  await ensurePhase6Tables();
  const db = getDb();
  const res = await db.query<DisplayRow>(
    `SELECT id::text, name, description, canvas_width, canvas_height, tiles, category_id::text
     FROM bi_display_report
     WHERE is_active = true
     ORDER BY lower(name)`,
  );
  return res.rows.map(rowToDisplay);
}

export async function getDisplayReportById(id: string): Promise<DisplayReport | null> {
  if (!UUID_RE.test(id)) return null;
  await ensurePhase6Tables();
  const db = getDb();
  const res = await db.query<DisplayRow>(
    `SELECT id::text, name, description, canvas_width, canvas_height, tiles, category_id::text
     FROM bi_display_report
     WHERE id = $1 AND is_active = true`,
    [id],
  );
  const row = res.rows[0];
  return row ? rowToDisplay(row) : null;
}

export async function createDisplayReport(ctx: AdminContext, body: DisplayReport) {
  await ensurePhase6Tables();
  const name = body.name?.trim();
  if (!name) return jsonOk({ message: "Name is required" }, 400);
  const id = body.id && body.id !== EMPTY_GUID && UUID_RE.test(body.id) ? body.id : crypto.randomUUID();
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  await db.query(
    `INSERT INTO bi_display_report (id, name, description, canvas_width, canvas_height, tiles, category_id, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, true, NOW(), NOW(), $8::jsonb, $8::jsonb)`,
    [
      id,
      name,
      body.description?.trim() ?? null,
      body.canvasWidth ?? 1920,
      body.canvasHeight ?? 1080,
      JSON.stringify(body.tiles ?? []),
      body.categoryId && UUID_RE.test(body.categoryId) ? body.categoryId : null,
      audit,
    ],
  );
  const created = await getDisplayReportById(id);
  return jsonOk(created);
}

export async function updateDisplayReport(ctx: AdminContext, id: string, body: DisplayReport) {
  if (!UUID_RE.test(id)) return jsonOk({ message: "Invalid id" }, 400);
  await ensurePhase6Tables();
  const name = body.name?.trim();
  if (!name) return jsonOk({ message: "Name is required" }, 400);
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const res = await db.query(
    `UPDATE bi_display_report
     SET name = $2, description = $3, canvas_width = $4, canvas_height = $5, tiles = $6::jsonb,
         category_id = $7, updated_at = NOW(), updated_by = $8::jsonb
     WHERE id = $1 AND is_active = true`,
    [
      id,
      name,
      body.description?.trim() ?? null,
      body.canvasWidth ?? 1920,
      body.canvasHeight ?? 1080,
      JSON.stringify(body.tiles ?? []),
      body.categoryId && UUID_RE.test(body.categoryId) ? body.categoryId : null,
      audit,
    ],
  );
  if ((res.rowCount ?? 0) === 0) return jsonOk({ message: "Display report not found" }, 404);
  const updated = await getDisplayReportById(id);
  return jsonOk(updated);
}

export async function deleteDisplayReport(ctx: AdminContext, id: string) {
  if (!UUID_RE.test(id)) return jsonOk({ message: "Invalid id" }, 400);
  await ensurePhase6Tables();
  const audit = auditUserJson(ctx.userId, ctx.userName);
  await softDeleteRow("bi_display_report", id, audit);
  return jsonOk({ ok: true });
}

export async function handleDisplayGetById(_ctx: CatalogUserContext, id: string) {
  const report = await getDisplayReportById(id);
  if (!report) return jsonOk({ message: "Display report not found" }, 404);
  return jsonOk(report);
}

export async function handleDisplayAdminGet(_ctx: AdminContext, subpath: string) {
  if (subpath === "display-reports") {
    return jsonOk(await listDisplayReports());
  }
  return null;
}

export async function handleDisplayAdminPost(ctx: AdminContext, request: NextRequest, subpath: string) {
  if (subpath !== "display-reports") return null;
  const body = await readJsonBody<DisplayReport>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  return createDisplayReport(ctx, body);
}

export async function handleDisplayAdminPut(ctx: AdminContext, request: NextRequest, subpath: string) {
  const match = subpath.match(/^display-reports\/([^/]+)$/);
  if (!match) return null;
  const body = await readJsonBody<DisplayReport>(request);
  if (!body) return jsonOk({ message: "Invalid body" }, 400);
  return updateDisplayReport(ctx, match[1], body);
}

export async function handleDisplayAdminDelete(ctx: AdminContext, subpath: string) {
  const match = subpath.match(/^display-reports\/([^/]+)$/);
  if (!match) return null;
  return deleteDisplayReport(ctx, match[1]);
}
