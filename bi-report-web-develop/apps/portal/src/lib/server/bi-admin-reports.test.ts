import { describe, expect, it, vi, beforeEach } from "vitest";
import { saveReport } from "./bi-admin-reports";

const mockInvalidate = vi.fn();
const queryMock = vi.fn();

vi.mock("./bi-admin-common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin-common")>();
  return {
    ...actual,
    invalidateAfterAdminWrite: (...args: unknown[]) => mockInvalidate(...args),
    getDb: () => ({ query: queryMock }),
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

const categoryId = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const pbiReport = "33333333-3333-4333-8333-333333333333";

const semanticModelId = "55555555-5555-4555-8555-555555555555";

const validBody = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Test report",
  reportCategory: categoryId,
  powerBiReportId: pbiReport,
  semanticModelId,
  applicationType: "power-bi",
  powerWorkSpaceId: workspace,
  rlsEnabled: false,
  enablePagination: true,
};

describe("saveReport", () => {
  beforeEach(() => {
    mockInvalidate.mockReset();
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM bi_report br")) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 1 };
    });
  });

  it("inserts on POST even when body includes a new id (does not 404)", async () => {
    const res = await saveReport(ctx, validBody);
    expect(res.status).toBe(200);
    const insertCall = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO bi_report"));
    expect(insertCall).toBeTruthy();
    expect(insertCall?.[1]?.[0]).toBe(validBody.id);
    const selectForUpdate = queryMock.mock.calls.find(
      (call) =>
        String(call[0]).includes("SELECT rls_role_mapping") &&
        String(call[0]).includes("FROM bi_report WHERE id"),
    );
    expect(selectForUpdate).toBeFalsy();
  });

  it("stores semantic model id and application type on add", async () => {
    await saveReport(ctx, validBody);
    const insertCall = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO bi_report"));
    expect(String(insertCall?.[0])).toContain("semanticmodel_id");
    expect(String(insertCall?.[0])).toContain("application_type");
    expect(insertCall?.[1]).toContain(semanticModelId);
    expect(insertCall?.[1]).toContain("power-bi");
  });

  it("rejects add without a semantic model id (400, no insert)", async () => {
    const { semanticModelId: _omit, ...withoutSemantic } = validBody;
    const res = await saveReport(ctx, withoutSemantic);
    expect(res.status).toBe(400);
    const insertCall = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO bi_report"));
    expect(insertCall).toBeFalsy();
  });

  it("updates only when reportId is provided on PUT", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT rls_role_mapping, rls_enabled FROM bi_report")) {
        return { rows: [{ rls_role_mapping: null, rls_enabled: false }] };
      }
      if (String(sql).includes("FROM bi_report br")) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 1 };
    });
    const res = await saveReport(ctx, validBody, validBody.id);
    expect(res.status).toBe(200);
    const updateCall = queryMock.mock.calls.find((call) => String(call[0]).includes("UPDATE bi_report"));
    expect(updateCall).toBeTruthy();
    const insertCall = queryMock.mock.calls.find((call) => String(call[0]).includes("INSERT INTO bi_report"));
    expect(insertCall).toBeFalsy();
  });

  it("returns 404 when PUT targets a missing report", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT rls_role_mapping, rls_enabled FROM bi_report")) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await saveReport(ctx, validBody, validBody.id);
    expect(res.status).toBe(404);
  });
});