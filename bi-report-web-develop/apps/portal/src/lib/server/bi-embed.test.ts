import path from "path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resetSemanticCatalogIndex } from "@/lib/catalog/dataset-from-catalog";
import { NextRequest } from "next/server";
import {
  handleBiDownloadPost,
  handleBiEmbedGet,
  isBiDownloadPath,
  isBiEmbedPath,
  issueEmbedTokenForReport,
} from "./bi-embed";

const mockEmailFromBearer = vi.fn();
const mockLoadCatalog = vi.fn();
const mockPortalEmbed = vi.fn();
const mockEmbedPaths = vi.fn();
const mockSpConfigured = vi.fn();
const mockPowerBiApi = vi.fn();
const mockAcquire = vi.fn();

vi.mock("@/lib/catalog/entra-user", () => ({
  emailFromBearer: (...args: unknown[]) => mockEmailFromBearer(...args),
}));

vi.mock("@/lib/catalog/reports-catalog", () => ({
  loadCatalogForEmail: (...args: unknown[]) => mockLoadCatalog(...args),
}));

vi.mock("@/lib/catalog/dev-db", () => ({
  getDevDbPool: () => ({ query: vi.fn() }),
}));

const mockResolveEmbedRls = vi.fn();

vi.mock("@/lib/catalog/rls-access", () => ({
  resolveEmbedRlsContext: (...args: unknown[]) => mockResolveEmbedRls(...args),
}));

vi.mock("@/lib/azure-embed/embed-token-issue", () => ({
  embedPathsConfigured: () => mockEmbedPaths(),
  requestPortalEmbedToken: (...args: unknown[]) => mockPortalEmbed(...args),
}));

vi.mock("@/lib/azure-embed/generate-embed-token", () => ({
  servicePrincipalConfigured: () => mockSpConfigured(),
  powerBiApiRequest: (...args: unknown[]) => mockPowerBiApi(...args),
  acquirePowerBiServiceToken: () => mockAcquire(),
  resolvePowerBiDatasetId: vi.fn().mockResolvedValue("133a9eff-1512-4775-bbfd-b9008d84e9fa"),
  RlsRolesRequiredError: class RlsRolesRequiredError extends Error {
    constructor(msg?: string) {
      super(msg);
      this.name = "RlsRolesRequiredError";
    }
  },
}));

describe("isBiEmbedPath", () => {
  it("matches GET token embededd", () => {
    expect(
      isBiEmbedPath("GET", [
        "bi-report-api",
        "v1",
        "report",
        "token",
        "00000000-0000-4000-8000-000000000001",
        "embededd",
      ]),
    ).toBe(true);
    expect(isBiEmbedPath("POST", ["bi-report-api", "v1", "report", "token", "x", "embededd"])).toBe(false);
  });
});

describe("isBiDownloadPath", () => {
  it("matches POST download", () => {
    expect(
      isBiDownloadPath("POST", [
        "bi-report-api",
        "v1",
        "report",
        "token",
        "report",
        "00000000-0000-4000-8000-000000000001",
        "download",
      ]),
    ).toBe(true);
  });
});

describe("handleBiEmbedGet", () => {
  beforeEach(() => {
    mockEmailFromBearer.mockReset();
    mockLoadCatalog.mockReset();
    mockPortalEmbed.mockReset();
    mockEmbedPaths.mockReset();
    mockSpConfigured.mockReset();
    mockEmbedPaths.mockReturnValue(true);
    mockPortalEmbed.mockResolvedValue({
      accessToken: "tok",
      embedUrl: "https://embed",
      reportId: "pbi-id",
    });
  });

  it("returns 401 without JWT", async () => {
    mockEmailFromBearer.mockResolvedValue(null);
    const request = new NextRequest(
      "http://localhost/api/bi/bi-report-api/v1/report/token/00000000-0000-4000-8000-000000000001/embededd",
    );
    const res = await handleBiEmbedGet(request, [
      "bi-report-api",
      "v1",
      "report",
      "token",
      "00000000-0000-4000-8000-000000000001",
      "embededd",
    ]);
    expect(res.status).toBe(401);
  });

  it("returns 403 when report not in catalog", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      isSuperAdmin: false,
      userInfo: { id: "u1", group: [] },
      reports: [],
    });
    const request = new NextRequest(
      "http://localhost/api/bi/bi-report-api/v1/report/token/00000000-0000-4000-8000-000000000001/embededd",
      { headers: { Authorization: "Bearer t" } },
    );
    const res = await handleBiEmbedGet(request, [
      "bi-report-api",
      "v1",
      "report",
      "token",
      "00000000-0000-4000-8000-000000000001",
      "embededd",
    ]);
    expect(res.status).toBe(403);
  });
});

describe("issueEmbedTokenForReport", () => {
  beforeEach(() => {
    resetSemanticCatalogIndex();
    process.chdir(path.resolve(__dirname, "../..", ".."));
    mockEmbedPaths.mockReturnValue(true);
    mockResolveEmbedRls.mockResolvedValue(null);
    mockPortalEmbed.mockResolvedValue({
      accessToken: "tok",
      embedUrl: "https://embed",
      reportId: "pbi",
    });
  });

  afterEach(() => {
    resetSemanticCatalogIndex();
  });

  it("returns embedded token DTO", async () => {
    const dto = await issueEmbedTokenForReport(
      {
        id: "cat-id",
        title: "My Report",
        powerBiReportId: "5320e04a-086f-41d0-b7f5-7b478652ee9f",
        workspaceId: "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd",
        rlsEnabled: false,
      },
      "user@example.com",
      false,
      "cat-id",
      "user-id",
    );
    expect(dto).toMatchObject({ token: "tok", embeddedUrl: "https://embed", reportName: "My Report" });
    expect(mockPortalEmbed).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "user@example.com",
        skipIdentity: true,
        roles: [],
        effectiveIdentity: undefined,
      }),
    );
  });
});

describe("handleBiDownloadPost", () => {
  beforeEach(() => {
    mockEmailFromBearer.mockReset();
    mockLoadCatalog.mockReset();
    mockSpConfigured.mockReturnValue(true);
    mockPowerBiApi.mockReset();
    mockAcquire.mockReset();
  });

  it("returns 400 when export format missing", async () => {
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
      "http://localhost/api/bi/bi-report-api/v1/report/token/report/00000000-0000-4000-8000-000000000001/download",
      { method: "POST", headers: { Authorization: "Bearer t" }, body: "{}" },
    );
    const res = await handleBiDownloadPost(request, [
      "bi-report-api",
      "v1",
      "report",
      "token",
      "report",
      "00000000-0000-4000-8000-000000000001",
      "download",
    ]);
    expect(res.status).toBe(400);
  });
});
