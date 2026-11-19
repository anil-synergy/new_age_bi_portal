import { getDb } from "./bi-admin-common";

let ensured = false;
let ensurePromise: Promise<void> | null = null;
let categoryHierarchyEnsured = false;
let categoryHierarchyPromise: Promise<void> | null = null;

export async function ensurePhase6Tables(): Promise<void> {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const db = getDb();
    await db.query(`
      CREATE TABLE IF NOT EXISTS bi_display_report (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        description text,
        canvas_width integer NOT NULL DEFAULT 1920,
        canvas_height integer NOT NULL DEFAULT 1080,
        tiles jsonb NOT NULL DEFAULT '[]'::jsonb,
        category_id uuid,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        created_by jsonb,
        updated_by jsonb,
        deleted_at timestamptz,
        deleted_by jsonb
      )`);
    await db.query(`
      CREATE TABLE IF NOT EXISTS bi_report_page_acl (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        bi_report_id uuid NOT NULL,
        page_name text NOT NULL,
        display_name text,
        allowed_user_ids jsonb DEFAULT '[]'::jsonb,
        allowed_group_ids jsonb DEFAULT '[]'::jsonb,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        created_by jsonb,
        updated_by jsonb,
        deleted_at timestamptz,
        deleted_by jsonb
      )`);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_bi_report_page_acl_report
      ON bi_report_page_acl (bi_report_id)
      WHERE is_active = true`);
    ensured = true;
  })();
  return ensurePromise;
}

/** Adds menu hierarchy columns when missing. Best-effort; only call from category save when parent is set. */
export async function ensureCategoryHierarchyColumns(): Promise<void> {
  if (categoryHierarchyEnsured) return;
  if (categoryHierarchyPromise) return categoryHierarchyPromise;
  categoryHierarchyPromise = (async () => {
    try {
      const db = getDb();
      await db.query(`ALTER TABLE bi_report_categories ADD COLUMN IF NOT EXISTS parent_id uuid`);
      await db.query(
        `DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'bi_report_categories_parent_id_fkey'
               AND table_name = 'bi_report_categories'
           ) THEN
             ALTER TABLE bi_report_categories
               ADD CONSTRAINT bi_report_categories_parent_id_fkey
               FOREIGN KEY (parent_id) REFERENCES bi_report_categories(id) ON DELETE SET NULL;
           END IF;
         END $$`,
      );
      await db.query(
        `ALTER TABLE bi_report_categories ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0`,
      );
      await db.query(`CREATE INDEX IF NOT EXISTS idx_bi_report_categories_parent ON bi_report_categories (parent_id)`);
      await db.query(
        `CREATE INDEX IF NOT EXISTS idx_bi_report_categories_parent_order ON bi_report_categories (parent_id, display_order)`,
      );
      const { invalidateAllCatalogCaches } = await import("@/lib/catalog/reports-catalog");
      invalidateAllCatalogCaches();
      categoryHierarchyEnsured = true;
    } catch (err) {
      categoryHierarchyPromise = null;
      throw err;
    }
  })();
  return categoryHierarchyPromise;
}

/** @visibleForTesting */
export function resetPhase6SchemaCacheForTests() {
  ensured = false;
  ensurePromise = null;
  categoryHierarchyEnsured = false;
  categoryHierarchyPromise = null;
}
