import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { handleBiSemanticModel, isBiSemanticModelPath } from "./bi-semantic-model";

const mockEmailFromBearer = vi.fn();
const mockLoadCatalog = vi.fn();
const mockRequestSemanticModel = vi.fn();

vi.mock("@/lib/catalog/entra-user", () => ({
  emailFromBearer: (...args: unknown[]) => mockEmailFromBearer(...args),
}));

vi.mock("@/lib/catalog/reports-catalog", () => ({
  loadCatalogForEmail: (...args: unknown[]) => mockLoadCatalog(...args),
}));

vi.mock("@/lib/azure-embed/function-client", () => ({
  requestSemanticModel: (...args: unknown[]) => mockRequestSemanticModel(...args),
}));

vi.mock("./bi-admin-common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin-common")>();
  return {
    ...actual,
    getDb: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
  };
});

const REPORT_ID = "00000000-0000-4000-8000-000000000001";
const PATH = ["bi-report-api", "v1", "report", REPORT_ID, "semantic-model"];

describe("isBiSemanticModelPath", () => {
  it("matches GET semantic-model only", () => {
    expect(isBiSemanticModelPath("GET", PATH)).toBe(true);
    expect(isBiSemanticModelPath("POST", PATH)).toBe(false);
    expect(isBiSemanticModelPath("GET", ["bi-report-api", "v1", "report", "reports"])).toBe(false);
  });
});

describe("handleBiSemanticModel", () => {
  beforeEach(() => {
    mockEmailFromBearer.mockReset();
    mockLoadCatalog.mockReset();
    mockRequestSemanticModel.mockReset();
    mockRequestSemanticModel.mockResolvedValue({ tables: [{ name: "Sales" }] });
  });

  it("returns 401 without JWT", async () => {
    mockEmailFromBearer.mockResolvedValue(null);
    const request = new NextRequest(`http://localhost/api/bi/${PATH.join("/")}`);
    const res = await handleBiSemanticModel(request, PATH);
    expect(res.status).toBe(401);
    expect(mockRequestSemanticModel).not.toHaveBeenCalled();
  });

  it("returns model from Azure Function for entitled report", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      isSuperAdmin: false,
      reports: [
        {
          id: REPORT_ID,
          workspaceId: "22222222-2222-4222-8222-222222222222",
          powerBiReportId: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
    const request = new NextRequest(`http://localhost/api/bi/${PATH.join("/")}`, {
      headers: { Authorization: "Bearer t" },
    });
    const res = await handleBiSemanticModel(request, PATH);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tables[0].name).toBe("Sales");
    expect(mockRequestSemanticModel).toHaveBeenCalled();
  });

  it("returns 404 when report is not entitled", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog.mockResolvedValue({
      userFound: true,
      isSuperAdmin: false,
      reports: [],
    });
    const request = new NextRequest(`http://localhost/api/bi/${PATH.join("/")}`, {
      headers: { Authorization: "Bearer t" },
    });
    const res = await handleBiSemanticModel(request, PATH);
    expect(res.status).toBe(404);
  });
});
