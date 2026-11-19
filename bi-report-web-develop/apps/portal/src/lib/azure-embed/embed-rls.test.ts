import { describe, expect, it } from "vitest";
import {
  buildEmbedEffectiveIdentity,
  buildFunctionEffectiveIdentity,
  buildRlsIdentities,
  embedRolesForReport,
  needsWorkspaceIdentityError,
  shouldApplyRlsIdentity,
} from "./embed-rls";
import type { PortalReport } from "@/types";

describe("buildRlsIdentities", () => {
  it("returns PO_SPEND-shaped identity", () => {
    const ids = buildRlsIdentities("user@x.com", ["BS_User"], "133a9eff-1512-4775-bbfd-b9008d84e9fa");
    expect(ids).toEqual([
      {
        username: "user@x.com",
        roles: ["BS_User"],
        datasets: ["133a9eff-1512-4775-bbfd-b9008d84e9fa"],
      },
    ]);
  });

  it("returns undefined without roles or dataset", () => {
    expect(buildRlsIdentities("u@x.com", [], "ds")).toBeUndefined();
    expect(buildRlsIdentities("u@x.com", ["R"], "")).toBeUndefined();
  });
});

describe("embedRolesForReport", () => {
  const base: PortalReport = {
    id: "1",
    title: "T",
    rlsEnabled: true,
    powerBiRlsRole: [{ id: "m1", rlsRole: "BS_User" }],
    allRlsRoleNames: ["BS_User", "BS_Admin"],
  };

  it("uses mapped roles for normal users", () => {
    expect(embedRolesForReport(base, false)).toEqual(["BS_User"]);
  });

  it("uses all catalog role names for super admin", () => {
    expect(embedRolesForReport(base, true)).toEqual(["BS_User", "BS_Admin"]);
  });

  it("returns no roles when rlsEnabled is false", () => {
    const noFlag = { ...base, rlsEnabled: false };
    expect(embedRolesForReport(noFlag, false)).toEqual([]);
    expect(embedRolesForReport(noFlag, true)).toEqual([]);
  });
});

describe("shouldApplyRlsIdentity", () => {
  const rlsReport: PortalReport = {
    id: "1",
    title: "T",
    rlsEnabled: true,
    rlsBypassed: false,
    powerBiRlsRole: [{ id: "m1", rlsRole: "BS_User" }],
  };

  it("is false when RLS is off", () => {
    expect(shouldApplyRlsIdentity({ ...rlsReport, rlsEnabled: false }, false)).toBe(false);
  });

  it("is true for RLS reports regardless of admin or bypass", () => {
    expect(shouldApplyRlsIdentity(rlsReport, false)).toBe(true);
    expect(shouldApplyRlsIdentity(rlsReport, true)).toBe(true);
    expect(shouldApplyRlsIdentity({ ...rlsReport, rlsBypassed: true }, false)).toBe(true);
  });
});

describe("buildFunctionEffectiveIdentity", () => {
  const ds = "133a9eff-1512-4775-bbfd-b9008d84e9fa";

  it("includes dataset with empty roles", () => {
    expect(buildFunctionEffectiveIdentity("u@x.com", [], ds)).toEqual({
      username: "u@x.com",
      roles: [],
      datasets: [ds],
    });
  });
});

describe("buildEmbedEffectiveIdentity", () => {
  const rlsReport: PortalReport = {
    id: "1",
    title: "T",
    rlsEnabled: true,
    powerBiRlsRole: [{ id: "m1", rlsRole: "BS_User" }],
  };
  const ds = "133a9eff-1512-4775-bbfd-b9008d84e9fa";

  it("returns undefined for non-RLS reports", () => {
    expect(buildEmbedEffectiveIdentity({ ...rlsReport, rlsEnabled: false }, false, "u@x.com", ["BS_User"], ds)).toBeUndefined();
  });

  it("builds identity for super admin when RLS is on", () => {
    expect(buildEmbedEffectiveIdentity(rlsReport, true, "u@x.com", ["BS_User", "BS_Admin"], ds)).toEqual({
      username: "u@x.com",
      roles: ["BS_User", "BS_Admin"],
      datasets: [ds],
    });
  });

  it("includes datasets when RLS applies", () => {
    expect(buildEmbedEffectiveIdentity(rlsReport, false, "u@x.com", ["BS_User"], ds)).toEqual({
      username: "u@x.com",
      roles: ["BS_User"],
      datasets: [ds],
    });
  });
});

describe("needsWorkspaceIdentityError", () => {
  it("detects PREMIUM_ASWL and workspace identity messages", () => {
    expect(needsWorkspaceIdentityError("PREMIUM_ASWL_ERROR")).toBe(true);
    expect(needsWorkspaceIdentityError("Workspace identity is not configured")).toBe(true);
    expect(needsWorkspaceIdentityError("requires effective identity")).toBe(false);
  });
});
