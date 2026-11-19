import { getDb } from "./bi-admin-common";

let hierarchySupported: boolean | undefined;

/** Read-only probe — never ALTERs schema (safe for GET / list). */
export async function categoryHierarchyColumnsExist(): Promise<boolean> {
  if (hierarchySupported !== undefined) return hierarchySupported;
  try {
    const db = getDb();
    const probe = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'bi_report_categories'
         AND column_name IN ('parent_id', 'display_order')`,
    );
    hierarchySupported = Number(probe.rows[0]?.n) === 2;
  } catch {
    hierarchySupported = false;
  }
  return hierarchySupported;
}

/** @visibleForTesting */
export function resetCategoryHierarchyProbeForAdmin(): void {
  hierarchySupported = undefined;
}