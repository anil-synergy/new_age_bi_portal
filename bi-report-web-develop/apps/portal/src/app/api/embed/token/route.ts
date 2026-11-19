import { NextRequest, NextResponse } from "next/server";
import { emailFromBearer } from "@/lib/catalog/entra-user";
import { loadCatalogForEmail, resolveCatalogReportForUser } from "@/lib/catalog/reports-catalog";
import { firstGuid, isRealGuid } from "@/lib/azure-embed";
import { findPortalReportInCatalog, resolveEmbedRoles } from "@/lib/azure-embed/embed-catalog-resolve";
import {
  datasetUsesWorkspaceIdentityEmbed,
  EmbedMissingRlsConfigError,
  resolveEmbedPayloadPolicy,
} from "@/lib/azure-embed/embed-payload-policy";
import { resolveEmbedRlsContext } from "@/lib/catalog/rls-access";
import { resolveDatasetForEmbed } from "@/lib/catalog/dataset-from-catalog";
import { requestPortalEmbedToken } from "@/lib/azure-embed/embed-token-issue";
import { RlsRolesRequiredError } from "@/lib/azure-embed/generate-embed-token";
import { BI_PORTAL_AUTH_FUNCTION } from "@/lib/azure-embed/function-client";
import { ensureEmbedUserMessage } from "@/lib/azure-embed/errors";
import type { EmbedTokenRequest, EmbedTokenResponse, PortalReport } from "@/types";
import { isFabricRayfinCatalogReport } from "@/lib/catalog/fabric-rayfin-detect";

const FABRIC_RAYFIN_EMBED_MESSAGE =
  "This catalog item is a Fabric Rayfin app. It embeds with delegated Entra (MSAL), not the Power BI embed token API.";

const TOKEN_REUSE_MARGIN_MS = 5 * 60 * 1000;
const tokenCache = new Map<string, { at: number; expiresAt: number; value: EmbedTokenResponse }>();
const inFlightTokens = new Map<string, Promise<EmbedTokenResponse>>();

function cacheKey(workspaceId: string, reportId: string, identity?: string) {
  return `${workspaceId}/${reportId}/${identity ?? ""}`;
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    let email: string | null = null;
    try {
      email = await emailFromBearer(authorization);
    } catch {
      email = null;
    }
    if (!email || !authorization) {
      return NextResponse.json({ message: "Sign in required" }, { status: 401 });
    }

    const body = (await request.json()) as EmbedTokenRequest & { catalogId?: string };
    let workspaceId = firstGuid(body.workspaceId);
    let reportId = firstGuid(body.reportId);
    let catalogReport: PortalReport | undefined;
    let isSuperAdmin = Boolean(body.isSuperAdmin);

    const catalog = await loadCatalogForEmail(email);
    isSuperAdmin = isSuperAdmin || catalog.isSuperAdmin;

    const catalogIdHint = body.catalogId && isRealGuid(body.catalogId) ? body.catalogId : undefined;
    catalogReport = findPortalReportInCatalog(catalog.reports, {
      catalogId: catalogIdHint,
      workspaceId,
      powerBiReportId: reportId,
    });
    if (catalogReport) {
      workspaceId = firstGuid(catalogReport.workspaceId, catalogReport.powerWorkSpaceId, workspaceId);
      reportId = firstGuid(catalogReport.powerBiReportId, reportId);
    }

    if (catalogIdHint && !isFabricRayfinCatalogReport(catalogReport)) {
      const resolved = await resolveCatalogReportForUser(email, catalogIdHint);
      if (resolved && isFabricRayfinCatalogReport(resolved)) {
        return NextResponse.json({ message: FABRIC_RAYFIN_EMBED_MESSAGE }, { status: 400 });
      }
      if (resolved && !catalogReport) catalogReport = resolved;
    }

    if (catalogReport && isFabricRayfinCatalogReport(catalogReport)) {
      return NextResponse.json({ message: FABRIC_RAYFIN_EMBED_MESSAGE }, { status: 400 });
    }

    if (!workspaceId || !reportId) {
      return NextResponse.json(
        { message: "A valid Power BI workspace ID and report ID are required to embed." },
        { status: 400 },
      );
    }

    const signedInEmail = email;
    let roles = resolveEmbedRoles(catalogReport, isSuperAdmin);
    let reportForPolicy: PortalReport | undefined = catalogReport;
    // bi_report.semanticmodel_id (portal DB) is the embed dataset; set from the catalog row or the RLS lookup.
    let semanticModelId: string | undefined = catalogReport?.semanticModelId;

    const userId = catalog.userInfo.id;
    if (userId && catalogReport) {
      isSuperAdmin = catalog.isSuperAdmin;
      roles = resolveEmbedRoles(catalogReport, isSuperAdmin);
      reportForPolicy = catalogReport;
    } else if (userId) {
      const rlsCtx = await resolveEmbedRlsContext(userId, {
        catalogReportId: catalogIdHint ?? catalogReport?.id,
        workspaceId,
        powerBiReportId: reportId,
      });
      if (rlsCtx) {
        isSuperAdmin = rlsCtx.isSuperAdmin;
        roles = rlsCtx.roles;
        workspaceId = firstGuid(rlsCtx.workspaceId, workspaceId) ?? workspaceId;
        reportId = firstGuid(rlsCtx.powerBiReportId, reportId) ?? reportId;
        semanticModelId = firstGuid(rlsCtx.semanticModelId, semanticModelId) ?? semanticModelId;
        reportForPolicy = catalogReport
          ? { ...catalogReport, rlsEnabled: rlsCtx.rlsEnabled, rlsBypassed: rlsCtx.rlsBypassed }
          : ({ rlsEnabled: rlsCtx.rlsEnabled, rlsBypassed: rlsCtx.rlsBypassed } as PortalReport);
      }
    }

    const datasetLookup = resolveDatasetForEmbed({
      workspaceId,
      powerBiReportId: reportId,
      portalCatalogId: catalogIdHint ?? catalogReport?.id,
      titles: [catalogReport?.title, catalogReport?.name].filter(Boolean) as string[],
    });
    // Portal DB first: the semantic model stored for this report. The metadata file is only a fallback
    // for reports saved before semanticmodel_id existed.
    const dbSemanticModelId = firstGuid(semanticModelId);
    const fileDatasetId = firstGuid(datasetLookup.datasetId);
    if (dbSemanticModelId && fileDatasetId && dbSemanticModelId.toLowerCase() !== fileDatasetId.toLowerCase()) {
      console.warn(
        `[embed] semantic model mismatch for report ${reportId}: portal DB ${dbSemanticModelId} vs metadata file ${fileDatasetId}; using portal DB.`,
      );
    }
    const datasetSource = dbSemanticModelId ? "portal_db" : fileDatasetId ? "metadata_file" : "none";
    const datasetId = dbSemanticModelId ?? fileDatasetId;

    if (!datasetId) {
      if (datasetLookup.source === "ambiguous") {
        return NextResponse.json(
          {
            message:
              "Multiple semantic models match this report title; set semanticmodel_id on the report in the portal database.",
          },
          { status: 400 },
        );
      }
      // JSONL inventory is optional; proceed without dataset and let BI_Portal_Auth / PBI resolve when possible.
    }

    const rlsEnabled = reportForPolicy?.rlsEnabled ?? catalogReport?.rlsEnabled ?? false;
    const rlsBypassed = reportForPolicy?.rlsBypassed ?? catalogReport?.rlsBypassed ?? false;

    const payload = resolveEmbedPayloadPolicy({
      signedInEmail,
      roles,
      datasetId: datasetId || undefined,
      isSuperAdmin,
      rlsEnabled,
      rlsBypassed,
    });

    const identityKey = `${payload.username}|${payload.roles.join(",")}|skip=${payload.skipIdentity}|ds=${datasetId ?? ""}|dsrc=${payload.applyDatasourceIdentity ? 1 : 0}|v9`;
    const key = cacheKey(workspaceId, reportId, identityKey);
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt - TOKEN_REUSE_MARGIN_MS > Date.now()) {
      return NextResponse.json(cached.value);
    }

  const issueToken = async (): Promise<EmbedTokenResponse> => {
    const token = await requestPortalEmbedToken({
      workspaceId,
      reportId,
      datasetId: datasetId || undefined,
      username: payload.username,
      roles: payload.roles,
      effectiveIdentity: payload.effectiveIdentity,
      skipIdentity: payload.skipIdentity,
      applyDatasourceIdentity: payload.applyDatasourceIdentity,
      rlsRolesForIdentityRetry: roles.length > 0 ? roles : undefined,
      embedType: body.embedType ?? ("report" as const),
      pageName: body.pageName,
      visualName: body.visualName,
    });

    if (!token.embedUrl || !token.accessToken) {
      throw new Error("Embed token response was incomplete.");
    }

    const expiresAt = token.expiration ? Date.parse(token.expiration) : Date.now() + 55 * 60 * 1000;
    tokenCache.set(key, {
      at: Date.now(),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 55 * 60 * 1000,
      value: token,
    });
    return token;
  };

    let inflight = inFlightTokens.get(key);
    if (!inflight) {
      inflight = issueToken().finally(() => {
        inFlightTokens.delete(key);
      });
      inFlightTokens.set(key, inflight);
    }

    const token = await inflight;

    return NextResponse.json(token, {
      headers: {
        "X-Embed-Rls-Applied": String(token.security?.rlsApplied ?? "unknown"),
        "X-Embed-Roles-Sent": String(payload.roles.length),
        "X-Embed-Dataset-Id": datasetId,
        "X-Embed-Dataset-Source": datasetSource,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (error instanceof EmbedMissingRlsConfigError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof RlsRolesRequiredError) {
      return NextResponse.json({ message: error.message }, { status: 403 });
    }
    const fallback =
      `Power BI embed token failed via Azure Function ${BI_PORTAL_AUTH_FUNCTION}. ` +
      "Verify AZURE_FUNCTION_CODE and Power BI GenerateToken on the function app.";
    const message = ensureEmbedUserMessage(errMsg, fallback);
    if (errMsg.includes("incomplete")) {
      return NextResponse.json({ message }, { status: 502 });
    }
    return NextResponse.json({ message }, { status: 502 });
  }
}