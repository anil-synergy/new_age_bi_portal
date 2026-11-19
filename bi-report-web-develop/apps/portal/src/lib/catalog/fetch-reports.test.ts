import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadReportsForUser, loadUserInfoForUser } from "./fetch-reports";

const mockLoadCatalog = vi.fn();

vi.mock("./reports-catalog", () => ({
  loadCatalogForEmail: (...args: unknown[]) => mockLoadCatalog(...args),
}));

describe("fetch-reports (Postgres-only)", () => {
  beforeEach(() => {
    mockLoadCatalog.mockReset();
    global.fetch = vi.fn();
  });

  it("loadReportsForUser does not call bi-report-api", async () => {
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      userInfo: { isSuperAdmin: false, isDepartmentAdmin: false, group: [] },
      reports: [],
    });
    const result = await loadReportsForUser("Bearer x", "user@example.com");
    expect(result.source).toBe("database");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("loadUserInfoForUser returns catalog userInfo without fetch", async () => {
    mockLoadCatalog.mockResolvedValue({
      userFound: false,
      userInfo: { isSuperAdmin: false, isDepartmentAdmin: false, email: "x@y.com", group: [] },
      reports: [],
    });
    const info = await loadUserInfoForUser("Bearer x", "x@y.com");
    expect(info.email).toBe("x@y.com");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
