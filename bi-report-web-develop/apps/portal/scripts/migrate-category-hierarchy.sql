-- Menu folder hierarchy for bi_report_categories (run as a DBA on environments where the app user cannot ALTER).
-- Idempotent.

ALTER TABLE bi_report_categories ADD COLUMN IF NOT EXISTS parent_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'bi_report_categories_parent_id_fkey'
      AND table_name = 'bi_report_categories'
  ) THEN
    ALTER TABLE bi_report_categories
      ADD CONSTRAINT bi_report_categories_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES bi_report_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE bi_report_categories ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bi_report_categories_parent ON bi_report_categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_bi_report_categories_parent_order ON bi_report_categories (parent_id, display_order);