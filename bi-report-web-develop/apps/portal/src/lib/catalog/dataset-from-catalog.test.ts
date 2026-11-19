import path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  resolveDatasetForEmbed,
  resolveDatasetFromSemanticCatalog,
  resetSemanticCatalogIndex,
} from "./dataset-from-catalog";

describe("resolveDatasetForEmbed", () => {
  const workspaceId = "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd";

  const creworksReportId = "5320e04a-086f-41d0-b7f5-7b478652ee9f";
  const creworksDataset = "f62d3080-c0b2-459e-a34b-6eafdff15f2a";

  const internalAuditReportId = "5e6ed4b7-6499-4dea-9a94-313a3a2eda52";
  const internalAuditDataset = "5a342526-b7ab-4da0-a43e-9c772cdefbba";
  const internalAuditTitle = "Office Internal Audit Tracker and Planner";

  beforeEach(() => {
    resetSemanticCatalogIndex();
    const portalRoot = path.resolve(__dirname, "../..", "..");
    process.chdir(portalRoot);
  });

  afterEach(() => {
    resetSemanticCatalogIndex();
  });

  it("resolves Creworks dataset by Power BI report_id from report_lookup_index.jsonl", () => {
    const hit = resolveDatasetForEmbed({
      workspaceId,
      powerBiReportId: creworksReportId,
    });
    expect(hit.datasetId).toBe(creworksDataset);
    expect(hit.source).toBe("report_id");
  });

  it("resolves Internal Audit dataset by report_id and by title fallback", () => {
    const byId = resolveDatasetForEmbed({
      workspaceId,
      powerBiReportId: internalAuditReportId,
    });
    expect(byId.datasetId).toBe(internalAuditDataset);

    const byTitle = resolveDatasetFromSemanticCatalog(workspaceId, internalAuditTitle);
    expect(byTitle).toBe(internalAuditDataset);
  });

  it("returns undefined when report_id and title are unknown", () => {
    expect(
      resolveDatasetForEmbed({
        workspaceId,
        powerBiReportId: "00000000-0000-4000-8000-000000000001",
      }).datasetId,
    ).toBeUndefined();
    expect(resolveDatasetFromSemanticCatalog(workspaceId, "Not In Catalog")).toBeUndefined();
  });
});
