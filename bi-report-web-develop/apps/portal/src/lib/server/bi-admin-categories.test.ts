import { describe, expect, it, vi, beforeEach } from "vitest";
import { listAllCategories, saveCategory } from "./bi-admin-categories";
import { resetCategoryHierarchyProbeForAdmin } from "./bi-admin-category-hierarchy";
import { resetPhase6SchemaCacheForTests } from "./bi-admin-schema";

const queryMock = vi.fn();

vi.mock("./bi-admin-common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin-common")>();
  return {
    ...actual,
    invalidateAfterAdminWrite: vi.fn(),
    getDb: () => ({ query: queryMock }),
  };
});

vi.mock("./bi-admin-schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin-schema")>();
  return {
    ...actual,
    ensureCategoryHierarchyColumns: vi.fn().mockRejectedValue(new Error("permission denied")),
  };
});

const ctx = {
  email: "admin@example.com",
  userId: "admin-id",
  userName: "Admin",
  isSuperAdmin: true,
  isDepAdmin: false,
  departmentCategoryIds: [],
};

describe("listAllCategories without hierarchy columns", () => {
  beforeEach(() => {
    queryMock.mockReset();
    resetCategoryHierarchyProbeForAdmin();
    resetPhase6SchemaCacheForTests();
  });

  it("returns categories without running ALTER", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ n: "0" }] };
      }
      if (sql.includes("FROM bi_report_categories") && !sql.includes("parent_id")) {
        return {
          rows: [
            {
              id: "cat-1",
              name: "Finance",
              description: null,
              department_admin: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await listAllCategories(ctx);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("Finance");
    expect(res[0].parentId).toBeNull();
    const alterCall = queryMock.mock.calls.find((call) => String(call[0]).includes("ALTER TABLE"));
    expect(alterCall).toBeFalsy();
  });
});

describe("saveCategory with parent when hierarchy missing", () => {
  beforeEach(() => {
    queryMock.mockReset();
    resetCategoryHierarchyProbeForAdmin();
    resetPhase6SchemaCacheForTests();
  });

  it("returns 400 instead of 500 when parent is set but migration is not applied", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return { rows: [{ n: "0" }] };
      }
      return { rows: [] };
    });

    const res = await saveCategory(ctx, {
      name: "Subfolder",
      parentId: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/hierarchy|parent/i);
  });
});