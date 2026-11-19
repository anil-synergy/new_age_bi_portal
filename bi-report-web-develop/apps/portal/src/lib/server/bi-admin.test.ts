import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { handleBiAdmin, isBiAdminPath } from "./bi-admin";
import { handleUsersPost } from "./bi-admin-users";

const mockRequireAdmin = vi.fn();
const mockRequireCatalogUser = vi.fn();
const mockListUsersPaged = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("./bi-admin-auth", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
  requireCatalogUser: (...args: unknown[]) => mockRequireCatalogUser(...args),
  requireSystemAdmin: (ctx: { isSuperAdmin: boolean }) =>
    ctx.isSuperAdmin ? null : new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
}));

vi.mock("./bi-admin-users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin-users")>();
  return {
    ...actual,
    handleUsersPost: vi.fn(),
    handleUsersGet: vi.fn(),
    handleUsersPut: vi.fn(),
    handleUsersDelete: vi.fn(),
    listUsersPaged: (...args: unknown[]) => mockListUsersPaged(...args),
  };
});

vi.mock("./bi-admin-groups", () => ({
  handleGroupsGet: vi.fn(),
  handleGroupsPost: vi.fn(),
  handleGroupsPut: vi.fn(),
  handleGroupsDelete: vi.fn(),
}));

vi.mock("./bi-admin-categories", () => ({
  handleCategoriesGet: vi.fn(),
  handleCategoriesPost: vi.fn(),
  handleCategoriesPut: vi.fn(),
  handleCategoriesDelete: vi.fn(),
}));

vi.mock("./bi-admin-reports", () => ({
  handleReportsGet: vi.fn(),
  handleReportsPost: vi.fn(),
  handleReportsPut: vi.fn(),
  handleReportsDelete: vi.fn(),
}));

vi.mock("./bi-admin-display", () => ({
  handleDisplayAdminGet: vi.fn(),
  handleDisplayAdminPost: vi.fn(),
  handleDisplayAdminPut: vi.fn(),
  handleDisplayAdminDelete: vi.fn(),
  handleDisplayGetById: vi.fn(),
}));

vi.mock("./bi-admin-pages", () => ({
  handlePagesGet: vi.fn(),
  handlePagesPut: vi.fn(),
}));

vi.mock("@/lib/catalog/reports-catalog", () => ({
  invalidateCatalogCache: (...args: unknown[]) => mockInvalidate(...args),
}));

describe("isBiAdminPath", () => {
  it("matches Phase 5 and Phase 6 admin routes", () => {
    expect(isBiAdminPath("POST", ["bi-report-api", "v1", "admin", "users"])).toBe(true);
    expect(isBiAdminPath("GET", ["bi-report-api", "v1", "admin", "display-reports"])).toBe(true);
    expect(isBiAdminPath("GET", ["bi-report-api", "v1", "admin", "reports", "x", "pages"])).toBe(true);
    expect(isBiAdminPath("GET", ["bi-report-api", "v1", "admin", "unknown", "route"])).toBe(false);
  });
});

describe("handleBiAdmin auth", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockListUsersPaged.mockReset();
  });

  it("returns 401 when requireAdmin fails", async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ message: "Sign in required" }, { status: 401 }));
    const request = new NextRequest("http://localhost/api/bi/bi-report-api/v1/admin/users", { method: "POST" });
    const res = await handleBiAdmin(request, ["bi-report-api", "v1", "admin", "users"]);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin catalog user on POST users", async () => {
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ message: "Forbidden" }, { status: 403 }),
    );
    const request = new NextRequest("http://localhost/api/bi/bi-report-api/v1/admin/users", {
      method: "POST",
      headers: { Authorization: "Bearer t" },
    });
    const res = await handleBiAdmin(request, ["bi-report-api", "v1", "admin", "users"]);
    expect(res.status).toBe(403);
  });

  it("delegates POST users to handler for super-admin", async () => {
    mockRequireAdmin.mockResolvedValue({
      email: "admin@example.com",
      userId: "u1",
      userName: "Admin",
      isSuperAdmin: true,
      isDepAdmin: false,
      departmentCategoryIds: [],
    });
    vi.mocked(handleUsersPost).mockResolvedValue(
      NextResponse.json({ items: [{ id: "x" }], currentPage: 1, totalPages: 1 }),
    );
    const request = new NextRequest("http://localhost/api/bi/bi-report-api/v1/admin/users", {
      method: "POST",
      headers: { Authorization: "Bearer t" },
      body: JSON.stringify({ page: 1, pageSize: 20 }),
    });
    const res = await handleBiAdmin(request, ["bi-report-api", "v1", "admin", "users"]);
    expect(res.status).toBe(200);
    expect(handleUsersPost).toHaveBeenCalled();
  });
});
