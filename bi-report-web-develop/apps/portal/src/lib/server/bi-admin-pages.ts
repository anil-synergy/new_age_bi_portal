import type { NextRequest } from "next/server";
import type { AdminContext } from "./bi-admin-auth";
import { auditUserJson, getDb, jsonOk, readJsonBody, UUID_RE } from "./bi-admin-common";
import { ensurePhase6Tables } from "./bi-admin-schema";
import type { PageACL } from "@/types";

type PageRow = {
  id: string;
  bi_report_id: string;
  page_name: string;
  display_name: string | null;
  allowed_user_ids: string[] | null;
  allowed_group_ids: string[] | null;
};

function rowToAcl(row: PageRow): PageACL {
  return {
    reportId: row.bi_report_id,
    pageName: row.page_name,
    displayName: row.display_name ?? row.page_name,
    allowedUserIds: row.allowed_user_ids ?? [],
    allowedGroupIds: row.allowed_group_ids ?? [],
  };
}

export async function getReportPageAcl(reportId: string): Promise<PageACL[]> {
  if (!UUID_RE.test(reportId)) return [];
  await ensurePhase6Tables();
  const db = getDb();
  const res = await db.query<PageRow>(
    `SELECT id::text, bi_report_id::text, page_name, display_name, allowed_user_ids, allowed_group_ids
     FROM bi_report_page_acl
     WHERE bi_report_id = $1 AND is_active = true
     ORDER BY page_name`,
    [reportId],
  );
  return res.rows.map(rowToAcl);
}

export async function replaceReportPageAcl(ctx: AdminContext, reportId: string, pages: PageACL[]) {
  if (!UUID_RE.test(reportId)) return jsonOk({ message: "Invalid report id" }, 400);
  await ensurePhase6Tables();
  const audit = auditUserJson(ctx.userId, ctx.userName);
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE bi_report_page_acl
       SET is_active = false, deleted_at = NOW(), deleted_by = $2::jsonb, updated_at = NOW(), updated_by = $2::jsonb
       WHERE bi_report_id = $1 AND is_active = true`,
      [reportId, audit],
    );
    for (const page of pages) {
      const pageName = page.pageName?.trim();
      if (!pageName) continue;
      await client.query(
        `INSERT INTO bi_report_page_acl (id, bi_report_id, page_name, display_name, allowed_user_ids, allowed_group_ids, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5::jsonb, true, NOW(), NOW(), $6::jsonb, $6::jsonb)`,
        [
          reportId,
          pageName,
          page.displayName?.trim() ?? pageName,
          JSON.stringify(page.allowedUserIds ?? []),
          JSON.stringify(page.allowedGroupIds ?? []),
          audit,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return jsonOk(await getReportPageAcl(reportId));
}

export async function handlePagesGet(_ctx: AdminContext, subpath: string) {
  const match = subpath.match(/^reports\/([^/]+)\/pages$/);
  if (!match) return null;
  return jsonOk(await getReportPageAcl(match[1]));
}

export async function handlePagesPut(ctx: AdminContext, request: NextRequest, subpath: string) {
  const match = subpath.match(/^reports\/([^/]+)\/pages$/);
  if (!match) return null;
  const body = await readJsonBody<{ pages?: PageACL[] }>(request);
  const pages = body?.pages ?? [];
  return replaceReportPageAcl(ctx, match[1], pages);
}
