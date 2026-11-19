export interface ManualReportConfig {
  workspaceId: string;
  reportId: string;
  datasetId: string;
  rlsUsername?: string;
  rlsRole?: string;
}

export type ReportSource = "powerbi" | "url";

export type TileSourceType = "powerbi-visual" | "powerbi-report" | "url";

export type EmbedType = "report" | "visual" | "dashboard";

export interface EffectiveIdentity {
  username: string;
  roles: string[];
  /** Power BI semantic model ids when RLS effective identity is required. */
  datasets?: string[];
}

export interface EmbedTokenRequest {
  workspaceId: string;
  reportId: string;
  /** Catalog row id (bi_report.id). Server uses it to fill missing Power BI IDs. */
  catalogId?: string;
  datasetId?: string;
  pageName?: string;
  visualName?: string;
  embedType: EmbedType;
  effectiveIdentity?: EffectiveIdentity;
  isSuperAdmin?: boolean;
  /** Server-only: signed-in user UPN/email for BI_Portal_Auth. */
  username?: string;
  /** Server-only: Power BI RLS role names from portal DB. */
  roles?: string[];
  /** Server-only: omit identities on GenerateToken (admin / Bypass RLS / Live-DQ path). */
  skipIdentity?: boolean;
  /** Server-only: attach username (+ optional identityBlob) for Live/DQ when RLS roles are skipped. */
  applyDatasourceIdentity?: boolean;
}

export interface EmbedTokenSecurity {
  rlsApplied?: boolean;
  roles?: string[];
  datasourceOnly?: boolean;
}

export interface EmbedTokenResponse {
  embedUrl: string;
  accessToken: string;
  reportId?: string;
  expiration?: string;
  enablePagination?: boolean;
  pages?: PageMeta[];
  /** When returned by BI_Portal_Auth (optional). */
  security?: EmbedTokenSecurity;
}

export interface PageMeta {
  name: string;
  displayName: string;
  order: number;
}

export interface TileConfig {
  id: string;
  sourceType: TileSourceType;
  reportId?: string;
  powerBiReportId?: string;
  workspaceId?: string;
  datasetId?: string;
  pageName?: string;
  visualName?: string;
  url?: string;
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

export interface DisplayReport {
  id: string;
  name: string;
  description?: string;
  canvasWidth: number;
  canvasHeight: number;
  tiles: TileConfig[];
  categoryId?: string;
}

export interface PageACL {
  reportId: string;
  pageName: string;
  displayName: string;
  allowedUserIds?: string[];
  allowedGroupIds?: string[];
}

export interface PortalReport {
  id: string;
  title: string;
  name?: string;
  description?: string;
  /** Catalog provider: power-bi (default), fabric-rayfin, etc. */
  applicationType?: string;
  /** Fabric Rayfin iframe URL from bi_fabric_apps.hosting_url. */
  hostingUrl?: string;
  /** Fabric Rayfin item id from bi_fabric_apps.app_id. */
  fabricAppId?: string;
  powerBiReportId?: string;
  workspaceId?: string;
  powerWorkSpaceId?: string;
  datasetId?: string;
  /** Power BI semantic model (dataset) id stored on bi_report.semanticmodel_id: the embed dataset. */
  semanticModelId?: string;
  sourceType?: ReportSource;
  url?: string;
  rlsEnabled?: boolean;
  rlsBypassed?: boolean;
  powerBiRlsRole?: { rlsRole: string; id: string }[];
  /** Every active Power BI role name on the report (for super-admin embed when RLS is required). */
  allRlsRoleNames?: string[];
  enablePagination?: boolean;
  categoryName?: string;
  categoryId?: string;
  /** Root-to-leaf category chain; absent when the database has no category hierarchy. */
  categoryPath?: CategoryPathItem[];
  favorite?: boolean;
}

export interface CategoryPathItem {
  id: string;
  name: string;
  parentId?: string | null;
  displayOrder?: number;
}

export interface UserInfo {
  isSuperAdmin: boolean;
  isDepartmentAdmin: boolean;
  id?: string;
  email?: string;
  name?: string;
  group: PermissionGroup[];
}

export interface PermissionGroup {
  id: string;
  name: string;
  reports?: PortalReport[];
}

export interface SemanticModelTable {
  name: string;
  columns: { name: string; dataType?: string }[];
  measures: { name: string; expression?: string }[];
}

export interface SemanticModel {
  tables: SemanticModelTable[];
  relationships?: { fromTable: string; toTable: string; fromColumn: string; toColumn: string }[];
}

export interface BulkUserRow {
  email: string;
  fullName: string;
  role?: string;
  groups?: string;
  valid: boolean;
  errors: string[];
}

/** Look of a note on the Visual box and the home screen. */
export interface NoteStyle {
  background: string;
  color: string;
  fontSize: number;
  fontFamily: "sans" | "serif" | "mono" | "hand";
  bold: boolean;
  italic: boolean;
}

/** A note created by N.O.V.A. through SMART. */
export interface NoteSpec {
  title: string;
  text: string;
  style: NoteStyle;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  type?: "text" | "chart" | "kpi" | "table" | "matrix";
  /** Set when N.O.V.A. created a note for this reply. */
  note?: NoteSpec;
  chartData?: ChartPayload;
  kpiData?: KpiPayload;
  matrixData?: MatrixPayload;
  /** Fields below are set only by the SMART orchestrator. */
  kind?: "answer" | "info" | "clarification" | "low_confidence" | "error";
  highlights?: string[];
  stats?: { label: string; value: string }[];
  kpis?: KpiPayload[];
  table?: TablePayload;
  citations?: { kind: string; name: string; table?: string }[];
  candidates?: string[];
  assumptions?: string[];
  confidence?: number;
  query?: string;
  agents?: string[];
  agentTrace?: AgentStep[];
  rlsUser?: string;
  elapsedMs?: number;
  /** Set when the user must open a report; panel auto-retries when reportId appears. */
  needsReportContext?: boolean;
  /** Portal catalog id. The chat panel navigates to this report. */
  openReportId?: string;
  /** Orchestrator request id; feedback is recorded against it. */
  requestId?: string;
  /** True when the answer came from SMART's semantic cache. */
  cached?: boolean;
  /** DEV or ARCHIVE when the user chose a non-production model. */
  environment?: string;
}

export interface AgentStep {
  step: string;
  status: "running" | "done" | "skipped";
  label: string;
  agent?: string;
  ms?: number;
}

export type { ChartType } from "./chart-types";

export interface ChartPayload {
  type: import("./chart-types").ChartType;
  labels: string[];
  datasets: { label: string; data: number[] }[];
  /** Full ECharts option for sankey, graph, map, etc. (values from query rows only). */
  echartsOption?: Record<string, unknown>;
  mapRegion?: "world" | "india";
  encoding?: Record<string, string>;
}

export interface KpiPayload {
  label: string;
  value: string | number;
  delta?: string;
}

export interface TablePayload {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
}

export interface MatrixPayload {
  row_field: string;
  column_field: string;
  value_field: string;
  row_labels: string[];
  column_labels: string[];
  cells: number[][];
  truncated?: boolean;
}
