import { describe, expect, it } from "vitest";
import { findPortalReportInCatalog, resolveEmbedRoles } from "./embed-catalog-resolve";
import type { PortalReport } from "@/types";

const reports: PortalReport[] = [
  {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    title: "Spend",
    powerBiReportId: "11111111-2222-3333-4444-555555555555",
    workspaceId: "aaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    rlsEnabled: false,
    powerBiRlsRole: [{ id: "1", rlsRole: "BS_User" }],
    allRlsRoleNames: ["BS_User", "BS_Admin"],
  },
];

describe("findPortalReportInCatalog", () => {
  it("matches catalog id case-insensitively", () => {
    const hit = findPortalReportInCatalog(reports, {
      catalogId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(hit?.title).toBe("Spend");
  });

  it("matches workspace and Power BI report id", () => {
    const hit = findPortalReportInCatalog(reports, {
      workspaceId: "AAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      powerBiReportId: "11111111-2222-3333-4444-555555555555",
    });
    expect(hit?.id).toBe(reports[0]!.id);
  });
});

describe("resolveEmbedRoles", () => {
  it("returns no roles when rlsEnabled is false (prod: no effective identity)", () => {
    expect(resolveEmbedRoles(reports[0], false)).toEqual([]);
    expect(resolveEmbedRoles(reports[0], true)).toEqual([]);
  });

  it("returns mapped roles for RLS reports when not admin", () => {
    const rls: PortalReport = { ...reports[0]!, rlsEnabled: true };
    expect(resolveEmbedRoles(rls, false)).toEqual(["BS_User"]);
  });

  it("returns no roles when catalog RLS is on but user has no mapping", () => {
    const bare: PortalReport = { id: "x", title: "X", rlsEnabled: true, powerBiRlsRole: [] };
    expect(resolveEmbedRoles(bare, false)).toEqual([]);
  });

  it("returns every report RLS role for super admin on RLS reports", () => {
    const rls: PortalReport = { ...reports[0]!, rlsEnabled: true, allRlsRoleNames: ["BS_User", "BS_Admin"] };
    expect(resolveEmbedRoles(rls, true)).toEqual(["BS_User", "BS_Admin"]);
  });

  it("returns every report RLS role for a bypass user on RLS reports", () => {
    const rls: PortalReport = { ...reports[0]!, rlsEnabled: true, rlsBypassed: true, allRlsRoleNames: ["BS_User"] };
    expect(resolveEmbedRoles(rls, false)).toEqual(["BS_User"]);
  });
});
