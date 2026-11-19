-- Fabric Rayfin catalog + access (mirror bi_report permission model).
-- Run once on BI catalog Postgres (after review).

BEGIN;

CREATE TABLE IF NOT EXISTS bi_fabric_apps (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_name            VARCHAR(100) NOT NULL,
    description         VARCHAR(1000) NOT NULL DEFAULT '',
    hosting_url         VARCHAR(1000) NOT NULL,
    workspace_id        UUID NOT NULL,
    app_id              UUID NOT NULL,
    report_category     UUID NOT NULL,
    semanticmodel_id    UUID NULL,
    application_type    VARCHAR(50) NOT NULL DEFAULT 'fabric-rayfin',
    rls_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    rls_role_mapping    JSONB NULL,
    created_by          JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          JSONB,
    updated_at          TIMESTAMPTZ,
    deleted_by          JSONB,
    deleted_at          TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT bi_fabric_apps_category_fkey
        FOREIGN KEY (report_category) REFERENCES bi_report_categories (id),
    CONSTRAINT bi_fabric_apps_app_type_chk
        CHECK (application_type IN ('fabric-rayfin'))
);

-- Optional: drop legacy column if you added group_id on the master row (permissions belong in junction tables).
-- ALTER TABLE bi_fabric_apps DROP COLUMN IF EXISTS group_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_fabric_apps_ws_app
    ON bi_fabric_apps (workspace_id, app_id)
    WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bi_fabric_apps_category
    ON bi_fabric_apps (report_category)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS bi_fabric_app_role_access (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bi_fabric_app_id  UUID NOT NULL REFERENCES bi_fabric_apps (id),
    role_id           UUID NOT NULL,
    permission        INTEGER NOT NULL DEFAULT 1,
    "RLS_Bypassed"    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by        JSONB,
    updated_by        JSONB,
    deleted_at        TIMESTAMPTZ,
    deleted_by        JSONB,
    CONSTRAINT bi_fabric_app_role_access_role_fkey FOREIGN KEY (role_id) REFERENCES role (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_fabric_app_role_access_active
    ON bi_fabric_app_role_access (bi_fabric_app_id, role_id)
    WHERE is_active = true AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bi_fabric_app_user_access (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bi_fabric_app_id  UUID NOT NULL REFERENCES bi_fabric_apps (id),
    user_id           UUID NOT NULL,
    email_address     VARCHAR(255),
    external_user_id  UUID NOT NULL DEFAULT gen_random_uuid(),
    permission        INTEGER NOT NULL DEFAULT 1,
    "RLS_Bypassed"    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by        JSONB,
    updated_by        JSONB,
    deleted_at        TIMESTAMPTZ,
    deleted_by        JSONB,
    CONSTRAINT bi_fabric_app_user_access_user_fkey FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bi_fabric_app_user_access_active
    ON bi_fabric_app_user_access (bi_fabric_app_id, user_id)
    WHERE is_active = true AND deleted_at IS NULL;

-- Favorites: extend existing table (preferred over duplicating bi_user_favorites).
ALTER TABLE bi_user_favorites
    ADD COLUMN IF NOT EXISTS bi_fabric_app_id UUID NULL REFERENCES bi_fabric_apps (id);

ALTER TABLE bi_user_favorites
    DROP CONSTRAINT IF EXISTS bi_user_favorites_one_target_chk;

ALTER TABLE bi_user_favorites
    ADD CONSTRAINT bi_user_favorites_one_target_chk CHECK (
        (bi_report_id IS NOT NULL AND bi_fabric_app_id IS NULL)
        OR (bi_report_id IS NULL AND bi_fabric_app_id IS NOT NULL)
    );

COMMIT;