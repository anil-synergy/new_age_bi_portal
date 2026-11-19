import { describe, expect, it } from "vitest";
import { buildDatasourceIdentities, ensureServicePrincipalInWorkspace } from "./generate-embed-token";

describe("buildDatasourceIdentities", () => {
  it("builds PO_SPEND-shaped datasourceIdentities", () => {
    const ds = buildDatasourceIdentities("sql-token", [
      { datasourceType: "Sql", connectionDetails: { server: "x.database.windows.net" } },
    ]);
    expect(ds).toEqual([
      {
        identityBlob: "sql-token",
        datasources: [{ datasourceType: "Sql", connectionDetails: { server: "x.database.windows.net" } }],
      },
    ]);
  });

  it("returns undefined without token or datasources", () => {
    expect(buildDatasourceIdentities(undefined, [{ datasourceType: "Sql" }])).toBeUndefined();
    expect(buildDatasourceIdentities("t", [])).toBeUndefined();
  });
});

describe("ensureServicePrincipalInWorkspace", () => {
  it("does not throw on workspace user list mismatch", async () => {
    await expect(ensureServicePrincipalInWorkspace("token", "ws")).resolves.toBeUndefined();
  });
});
