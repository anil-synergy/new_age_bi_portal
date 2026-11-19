import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { handleBiCatalogRead, isBiCatalogReadPath } from "./bi-catalog-reads";

const mockLoadCatalog = vi.fn();
const mockEmailFromBearer = vi.fn();

vi.mock("@/lib/catalog/entra-user", () => ({
  emailFromBearer: (...args: unknown[]) => mockEmailFromBearer(...args),
}));

vi.mock("@/lib/catalog/reports-catalog", () => ({
  loadCatalogForEmail: (...args: unknown[]) => mockLoadCatalog(...args),
}));

describe("isBiCatalogReadPath", () => {
  it("matches GET userInfo and GET reports only", () => {
    expect(isBiCatalogReadPath("GET", ["bi-report-api", "v1", "user", "userInfo"])).toBe(true);
    expect(isBiCatalogReadPath("GET", ["bi-report-api", "v1", "report", "reports"])).toBe(true);
  });

  it("rejects non-GET and other paths", () => {
    expect(isBiCatalogReadPath("PUT", ["bi-report-api", "v1", "report", "favoriteReport"])).toBe(false);
    expect(isBiCatalogReadPath("GET", ["bi-report-api", "v1", "report", "favoriteReport"])).toBe(false);
    expect(isBiCatalogReadPath("GET", ["bi-report-api", "v1", "admin", "reports"])).toBe(false);
  });
});

describe("handleBiCatalogRead", () => {
  beforeEach(() => {
    mockLoadCatalog.mockReset();
    mockEmailFromBearer.mockReset();
  });

  it("returns 401 when JWT is missing", async () => {
    mockEmailFromBearer.mockResolvedValue(null);
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/user/userInfo");
    const res = await handleBiCatalogRead(request, ["bi-report-api", "v1", "user", "userInfo"]);
    expect(res.status).toBe(401);
    expect(mockLoadCatalog).not.toHaveBeenCalled();
  });

  it("returns 401 when user is not in the catalog", async () => {
    mockEmailFromBearer.mockResolvedValue("unknown@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: false,
      userInfo: { isSuperAdmin: false, isDepartmentAdmin: false, group: [] },
      reports: [],
    });
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/user/userInfo", {
      headers: { Authorization: "Bearer token" },
    });
    const res = await handleBiCatalogRead(request, ["bi-report-api", "v1", "user", "userInfo"]);
    expect(res.status).toBe(401);
  });

  it("returns userInfo and reports when user exists", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      userInfo: { id: "u1", email: "user@example.com", isSuperAdmin: false, isDepartmentAdmin: false, group: [] },
      reports: [{ id: "r1", title: "Report", name: "Report" }],
    });
    const headers = { Authorization: "Bearer token" };

    const infoReq = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/user/userInfo", { headers });
    const infoRes = await handleBiCatalogRead(infoReq, ["bi-report-api", "v1", "user", "userInfo"]);
    expect(infoRes.status).toBe(200);
    expect(await infoRes.json()).toMatchObject({ email: "user@example.com" });

    const reportsReq = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/report/reports", { headers });
    const reportsRes = await handleBiCatalogRead(reportsReq, ["bi-report-api", "v1", "report", "reports"]);
    expect(reportsRes.status).toBe(200);
    expect(await reportsRes.json()).toEqual([{ id: "r1", title: "Report", name: "Report" }]);
  });
});
