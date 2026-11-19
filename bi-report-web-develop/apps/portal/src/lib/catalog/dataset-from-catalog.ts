import fs from "fs";
import path from "path";
import { isRealGuid } from "@/lib/azure-embed/ids";

type CatalogReportRef = {
  report_id?: string;
  report_name?: string;
};

type CatalogRow = {
  dataset_id?: string;
  workspace_id?: string;
  report_names?: string[];
  reports?: CatalogReportRef[];
};

type ReportLookupRow = {
  report_id?: string;
  dataset_id?: string;
  workspace_id?: string;
};

type PortalCatalogRow = {
  portal_id?: string;
  report_id?: string;
  workspace_id?: string;
  dataset_id?: string;
  title?: string;
  report_name?: string;
};

type CatalogIndex = {
  byReportId: Map<string, string>;
  byWorkspaceReport: Map<string, string>;
  byWorkspaceTitle: Map<string, string>;
  ambiguousTitle: Set<string>;
  byPortalId: Map<string, string>;
  loadedFiles: string[];
};

let indexCache: CatalogIndex | null = null;

const WORKSPACE_METADATA_REL =
  "src/modules/smart-chatbot/agents/pbi_semantiq_agent/pbi_semantic_metadata/Workspace_semantic_metadata";

const REPORT_LOOKUP_FILE = "report_lookup_index.jsonl";
const SEMANTIC_MODEL_FILE = "semantic_model_catalog.jsonl";
const PORTAL_CATALOG_FILE = "portal_report_semantic_catalog.jsonl";

function workspaceMetadataRoot(): string {
  const root = process.cwd();
  const fromEnv = process.env.PBI_METADATA_ROOT?.trim();
  if (fromEnv) return fromEnv;
  return path.join(root, WORKSPACE_METADATA_REL);
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function looseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normWs(ws: string): string {
  return norm(ws);
}

function setReportMapping(
  idx: CatalogIndex,
  workspaceId: string | undefined,
  reportId: string,
  datasetId: string,
) {
  const rid = norm(reportId);
  const existing = idx.byReportId.get(rid);
  if (existing && existing !== datasetId) {
    // keep first; ambiguous report→dataset handled by workspace key below
  } else if (!existing) {
    idx.byReportId.set(rid, datasetId);
  }
  if (workspaceId && isRealGuid(workspaceId)) {
    const key = `${normWs(workspaceId)}|${rid}`;
    const prev = idx.byWorkspaceReport.get(key);
    if (prev && prev !== datasetId) {
      // workspace-scoped wins on last write for same key — rare
    }
    idx.byWorkspaceReport.set(key, datasetId);
  }
}

function setTitleMapping(
  idx: CatalogIndex,
  workspaceId: string,
  name: string,
  datasetId: string,
) {
  const variants = new Set([norm(name), looseTitle(name)].filter(Boolean));
  for (const variant of variants) {
    const key = `${normWs(workspaceId)}|${variant}`;
    const prev = idx.byWorkspaceTitle.get(key);
    if (prev && prev !== datasetId) {
      idx.ambiguousTitle.add(key);
    } else {
      idx.byWorkspaceTitle.set(key, datasetId);
    }
  }
}

function mergeReportLookupFile(idx: CatalogIndex, file: string) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  let rows = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as ReportLookupRow;
      const datasetId = String(row.dataset_id ?? "").trim();
      const reportId = String(row.report_id ?? "").trim();
      const workspaceId = String(row.workspace_id ?? "").trim();
      if (!isRealGuid(datasetId) || !isRealGuid(reportId)) continue;
      setReportMapping(idx, isRealGuid(workspaceId) ? workspaceId : undefined, reportId, datasetId);
      rows += 1;
    } catch {
      // skip
    }
  }
  if (rows > 0) idx.loadedFiles.push(file);
}

function mergeSemanticModelFile(idx: CatalogIndex, file: string) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  let rows = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as CatalogRow;
      const datasetId = String(row.dataset_id ?? "").trim();
      const workspaceId = String(row.workspace_id ?? "").trim();
      if (!isRealGuid(datasetId) || !isRealGuid(workspaceId)) continue;

      for (const ref of row.reports ?? []) {
        const reportId = String(ref.report_id ?? "").trim();
        const name = String(ref.report_name ?? "").trim();
        if (isRealGuid(reportId)) {
          setReportMapping(idx, workspaceId, reportId, datasetId);
        }
        if (name) setTitleMapping(idx, workspaceId, name, datasetId);
      }

      for (const name of row.report_names ?? []) {
        const n = String(name).trim();
        if (!n) continue;
        setTitleMapping(idx, workspaceId, n, datasetId);
      }
      rows += 1;
    } catch {
      // skip bad line
    }
  }
  if (rows > 0) idx.loadedFiles.push(file);
}

function mergePortalFile(idx: CatalogIndex, file: string) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as PortalCatalogRow;
      const datasetId = String(row.dataset_id ?? "").trim();
      const workspaceId = String(row.workspace_id ?? "").trim();
      const reportId = String(row.report_id ?? "").trim();
      const portalId = String(row.portal_id ?? "").trim();
      if (!isRealGuid(datasetId)) continue;
      if (isRealGuid(reportId)) {
        setReportMapping(idx, isRealGuid(workspaceId) ? workspaceId : undefined, reportId, datasetId);
      }
      if (isRealGuid(portalId)) {
        idx.byPortalId.set(norm(portalId), datasetId);
      }
      if (isRealGuid(workspaceId)) {
        const title = String(row.title ?? row.report_name ?? "").trim();
        if (title) setTitleMapping(idx, workspaceId, title, datasetId);
      }
    } catch {
      // skip
    }
  }
  idx.loadedFiles.push(file);
}

function buildIndex(): CatalogIndex {
  const metaRoot = workspaceMetadataRoot();
  const idx: CatalogIndex = {
    byReportId: new Map(),
    byWorkspaceReport: new Map(),
    byWorkspaceTitle: new Map(),
    ambiguousTitle: new Set(),
    byPortalId: new Map(),
    loadedFiles: [],
  };

  mergeReportLookupFile(idx, path.join(metaRoot, REPORT_LOOKUP_FILE));
  mergeSemanticModelFile(idx, path.join(metaRoot, SEMANTIC_MODEL_FILE));

  const portalFile = path.join(metaRoot, PORTAL_CATALOG_FILE);
  if (fs.existsSync(portalFile)) mergePortalFile(idx, portalFile);

  return idx;
}

let indexSignature = "";
let indexCheckedAt = 0;
const INDEX_RECHECK_MS = 5_000;

/** Cheap fingerprint (mtime+size) of the JSONL files the index is built from. */
function metadataSignature(): string {
  const root = workspaceMetadataRoot();
  return [REPORT_LOOKUP_FILE, SEMANTIC_MODEL_FILE, PORTAL_CATALOG_FILE]
    .map((name) => {
      try {
        const st = fs.statSync(path.join(root, name));
        return `${name}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${name}:-`;
      }
    })
    .join("|");
}

function getIndex(): CatalogIndex {
  const now = Date.now();
  if (indexCache && now - indexCheckedAt < INDEX_RECHECK_MS) return indexCache;
  const sig = metadataSignature();
  indexCheckedAt = now;
  if (!indexCache || sig !== indexSignature) {
    indexCache = buildIndex();
    indexSignature = sig;
  }
  return indexCache;
}

export type DatasetLookupInput = {
  workspaceId: string;
  powerBiReportId?: string;
  portalCatalogId?: string;
  titles?: string[];
};

export type DatasetLookupResult = {
  datasetId?: string;
  source?: "report_id" | "workspace_report" | "portal_id" | "title" | "ambiguous";
  matchedTitle?: string;
  loadedFiles?: string[];
};

/** Resolve dataset GUID from Workspace_semantic_metadata (report_id first, then title). */
export function resolveDatasetForEmbed(input: DatasetLookupInput): DatasetLookupResult {
  const idx = getIndex();
  const meta = { loadedFiles: [...idx.loadedFiles] };

  const reportId = input.powerBiReportId?.trim();
  if (reportId && isRealGuid(reportId)) {
    const rid = norm(reportId);
    if (isRealGuid(input.workspaceId)) {
      const scoped = idx.byWorkspaceReport.get(`${normWs(input.workspaceId)}|${rid}`);
      if (scoped && isRealGuid(scoped)) {
        return { datasetId: scoped, source: "workspace_report", ...meta };
      }
    }
    const global = idx.byReportId.get(rid);
    if (global && isRealGuid(global)) {
      return { datasetId: global, source: "report_id", ...meta };
    }
  }

  const portalId = input.portalCatalogId?.trim();
  if (portalId && isRealGuid(portalId)) {
    const hit = idx.byPortalId.get(norm(portalId));
    if (hit && isRealGuid(hit)) {
      return { datasetId: hit, source: "portal_id", ...meta };
    }
  }

  if (!isRealGuid(input.workspaceId)) return meta;

  const titles = (input.titles ?? []).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const title of titles) {
    for (const variant of [norm(title), looseTitle(title)]) {
      if (!variant || seen.has(variant)) continue;
      seen.add(variant);
      const key = `${normWs(input.workspaceId)}|${variant}`;
      if (idx.ambiguousTitle.has(key)) {
        return { source: "ambiguous", matchedTitle: title, ...meta };
      }
      const hit = idx.byWorkspaceTitle.get(key);
      if (hit && isRealGuid(hit)) {
        return { datasetId: hit, source: "title", matchedTitle: title, ...meta };
      }
    }
  }

  return meta;
}

/** @deprecated Use resolveDatasetForEmbed */
export function resolveDatasetFromSemanticCatalog(
  workspaceId: string,
  reportTitle: string | undefined,
): string | undefined {
  return resolveDatasetForEmbed({ workspaceId, titles: reportTitle ? [reportTitle] : [] }).datasetId;
}

/** Test helper: clear in-memory index after env/path changes. */
export function resetSemanticCatalogIndex(): void {
  indexCache = null;
  indexSignature = "";
  indexCheckedAt = 0;
}
