import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxyBiRequest } from "./bi-api-proxy";

vi.mock("@/lib/catalog/dev-db", () => ({
  getDevDbPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  }),
}));

const mockEmailFromBearer = vi.fn();
const mockLoadCatalog = vi.fn();
const mockToggleFavorite = vi.fn();
const mockInvalidateCatalog = vi.fn();

vi.mock("@/lib/catalog/entra-user", () => ({
  emailFromBearer: (...args: unknown[]) => mockEmailFromBearer(...args),
}));

vi.mock("@/lib/catalog/reports-catalog", () => ({
  loadCatalogForEmail: (...args: unknown[]) => mockLoadCatalog(...args),
  toggleFavoriteForUser: (...args: unknown[]) => mockToggleFavorite(...args),
  invalidateCatalogCache: (...args: unknown[]) => mockInvalidateCatalog(...args),
}));

vi.mock("@/lib/azure-embed/embed-token-issue", () => ({
  embedPathsConfigured: vi.fn(() => true),
  requestPortalEmbedToken: vi.fn().mockResolvedValue({
    accessToken: "tok",
    embedUrl: "https://embed",
    reportId: "pbi",
  }),
}));

vi.mock("@/lib/azure-embed/generate-embed-token", () => ({
  servicePrincipalConfigured: vi.fn(() => true),
  powerBiApiRequest: vi.fn(),
  acquirePowerBiServiceToken: vi.fn(),
}));

const mockHandleBiAdmin = vi.fn();
const mockHandleBiSemanticModel = vi.fn();

vi.mock("@/lib/server/bi-embed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-embed")>();
  return {
    ...actual,
    isBiDownloadPath: () => false,
  };
});

vi.mock("@/lib/server/bi-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin")>();
  return {
    ...actual,
    handleBiAdmin: (...args: unknown[]) => mockHandleBiAdmin(...args),
    isBiAdminPath: (method: string, path: string[]) => {
      const suffix = path.slice(2).join("/");
      if (method === "POST" && suffix === "admin/reports") return true;
      if (method === "GET" && suffix === "admin/display-reports") return true;
      if (method === "GET" && suffix === "admin/reports/x/pages") return true;
      return false;
    },
  };
});

vi.mock("@/lib/server/bi-semantic-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-semantic-model")>();
  return {
    ...actual,
    handleBiSemanticModel: (...args: unknown[]) => mockHandleBiSemanticModel(...args),
    isBiSemanticModelPath: (method: string, path: string[]) =>
      method === "GET" && path.join("/") === "bi-report-api/v1/report/00000000-0000-4000-8000-000000000002/semantic-model",
  };
});

describe("proxyBiRequest", () => {
  const originalFetch = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    mockEmailFromBearer.mockReset();
    mockLoadCatalog.mockReset();
    mockToggleFavorite.mockReset();
    mockInvalidateCatalog.mockReset();
    mockHandleBiAdmin.mockReset();
    mockHandleBiSemanticModel.mockReset();
    mockToggleFavorite.mockResolvedValue(undefined);
    mockHandleBiAdmin.mockResolvedValue(
      new Response(JSON.stringify({ items: [], currentPage: 1, totalPages: 1 }), { status: 200 }),
    );
    mockHandleBiSemanticModel.mockResolvedValue(
      new Response(JSON.stringify({ tables: [] }), { status: 200 }),
    );
    global.fetch = fetchMock as typeof fetch;
    delete process.env.BI_API_BASE;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.BI_API_BASE;
  });

  it("handles health paths locally without calling fetch", async () => {
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/ping");
    const res = await proxyBiRequest(request, ["bi-report-api", "v1", "ping"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BI Portal (Next.js)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles GET reports locally without calling fetch when BI_API_BASE is unset", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      userInfo: { isSuperAdmin: false, isDepartmentAdmin: false, group: [] },
      reports: [{ id: "r1", title: "T", name: "T" }],
    });
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/report/reports", {
      headers: { Authorization: "Bearer token" },
    });
    const res = await proxyBiRequest(request, ["bi-report-api", "v1", "report", "reports"]);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles PUT favoriteReport locally without calling fetch", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog
      .mockResolvedValueOnce({
        userFound: true,
        userInfo: { id: "u1", name: "U", isSuperAdmin: false, isDepartmentAdmin: false, group: [] },
        reports: [],
      })
      .mockResolvedValueOnce({
        userFound: true,
        userInfo: { id: "u1", name: "U", isSuperAdmin: false, isDepartmentAdmin: false, group: [] },
        reports: [{ id: "r1", title: "T", name: "T", favorite: true }],
      });
    const request = new NextRequest(
      "http://localhost:3000/api/bi/bi-report-api/v1/report/favoriteReport?reportId=00000000-0000-4000-8000-000000000001",
      { method: "PUT", headers: { Authorization: "Bearer token" } },
    );
    const res = await proxyBiRequest(request, ["bi-report-api", "v1", "report", "favoriteReport"]);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockToggleFavorite).toHaveBeenCalled();
  });

  it("handles GET embededd locally without upstream fetch", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      isSuperAdmin: true,
      userInfo: { id: "u1", group: [] },
      reports: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          title: "R",
          powerBiReportId: "11111111-1111-4111-8111-111111111111",
          workspaceId: "22222222-2222-4222-8222-222222222222",
        },
      ],
    });
    const request = new NextRequest(
      "http://localhost:3000/api/bi/bi-report-api/v1/report/token/00000000-0000-4000-8000-000000000001/embededd",
      { headers: { Authorization: "Bearer token" } },
    );
    const res = await proxyBiRequest(request, [
      "bi-report-api",
      "v1",
      "report",
      "token",
      "00000000-0000-4000-8000-000000000001",
      "embededd",
    ]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("tok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles POST admin reports locally without upstream fetch", async () => {
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/admin/reports", { method: "POST" });
    const res = await proxyBiRequest(request, ["bi-report-api", "v1", "admin", "reports"]);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockHandleBiAdmin).toHaveBeenCalled();
  });

  it("handles GET admin report pages locally without upstream fetch", async () => {
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/admin/reports/x/pages");
    const res = await proxyBiRequest(request, ["bi-report-api", "v1", "admin", "reports", "x", "pages"]);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockHandleBiAdmin).toHaveBeenCalled();
  });

  it("handles GET semantic-model locally without upstream fetch", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/bi/bi-report-api/v1/report/00000000-0000-4000-8000-000000000002/semantic-model",
      { headers: { Authorization: "Bearer token" } },
    );
    const res = await proxyBiRequest(request, [
      "bi-report-api",
      "v1",
      "report",
      "00000000-0000-4000-8000-000000000002",
      "semantic-model",
    ]);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockHandleBiSemanticModel).toHaveBeenCalled();
  });

  it("returns 404 for unknown paths without calling fetch", async () => {
    const request = new NextRequest("http://localhost:3000/api/bi/bi-report-api/v1/admin/legacy/endpoint");
    const res = await proxyBiRequest(request, ["bi-report-api", "v1", "admin", "legacy", "endpoint"]);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe("Not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
