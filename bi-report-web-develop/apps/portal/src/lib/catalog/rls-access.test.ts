import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveEmbedRlsContext } from "./rls-access";

const mockQuery = vi.fn();

vi.mock("./dev-db", () => ({
  getDevDbPool: () => ({ query: mockQuery }),
}));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("resolveEmbedRlsContext", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns mapped RLS roles when enabled and user is in mapping", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: REPORT_ID,
            rls_enabled: true,
            rls_role_mapping: {
              RoleMappings: [
                { RlsRole: "BS_User", Users: [USER_ID], IsActive: true },
              ],
            },
            powerbi_report_id: "11111111-1111-4111-8111-111111111111",
            powerbi_workspace_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: GROUP_ID, name: "Viewer" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const ctx = await resolveEmbedRlsContext(USER_ID, { catalogReportId: REPORT_ID });
    expect(ctx?.roles).toEqual(["BS_User"]);
    expect(ctx?.rlsBypassed).toBe(false);
    expect(ctx?.isSuperAdmin).toBe(false);
  });

  it("returns every report RLS role for System Admin", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: REPORT_ID,
            rls_enabled: true,
            rls_role_mapping: {
              RoleMappings: [{ RlsRole: "BS_User", Users: [USER_ID], IsActive: true }],
            },
            powerbi_report_id: "11111111-1111-4111-8111-111111111111",
            powerbi_workspace_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: GROUP_ID, name: "System Admin" }] });

    const ctx = await resolveEmbedRlsContext(USER_ID, { catalogReportId: REPORT_ID });
    expect(ctx?.isSuperAdmin).toBe(true);
    expect(ctx?.roles).toEqual(["BS_User"]);
  });

  it("returns every report RLS role when RLS_Bypassed on user access", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: REPORT_ID,
            rls_enabled: true,
            rls_role_mapping: {
              RoleMappings: [{ RlsRole: "BS_User", Users: [USER_ID], IsActive: true }],
            },
            powerbi_report_id: "11111111-1111-4111-8111-111111111111",
            powerbi_workspace_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: GROUP_ID, name: "Viewer" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rls_bypassed: true }] });

    const ctx = await resolveEmbedRlsContext(USER_ID, { catalogReportId: REPORT_ID });
    expect(ctx?.rlsBypassed).toBe(true);
    expect(ctx?.roles).toEqual(["BS_User"]);
  });

  it("maps group-based RLS roles", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: REPORT_ID,
            rls_enabled: true,
            rls_role_mapping: {
              RoleMappings: [{ RlsRole: "Dept_User", Groups: [GROUP_ID], IsActive: true }],
            },
            powerbi_report_id: "11111111-1111-4111-8111-111111111111",
            powerbi_workspace_id: "22222222-2222-4222-8222-222222222222",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: GROUP_ID, name: "Finance" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const ctx = await resolveEmbedRlsContext(USER_ID, { catalogReportId: REPORT_ID });
    expect(ctx?.roles).toEqual(["Dept_User"]);
  });
});
