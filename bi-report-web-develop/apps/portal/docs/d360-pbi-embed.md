# BI_Portal_Auth — portal RLS contract

Deploy this as the **BI_Portal_Auth** HTTP trigger (`POST https://hawkeye-sp-wrtb-func.azurewebsites.net/api/BI_Portal_Auth`). The Next.js portal calls it server-side with the function key (`AZURE_FUNCTION_CODE`). It must **not** require App Service Easy Auth; allow anonymous at the function level and rely on the key.

(Legacy name: `D360_PBI_Embed`.)

## Power BI only — not Fabric Rayfin

This function uses **Power BI REST** (`GET groups/{ws}/reports/{reportId}` and `GenerateToken`). **Fabric Rayfin** apps (portal table `bi_fabric_apps`, Rayfin `app_id` + `hosting_url`) are **not** Power BI reports. Do not send their workspace/app ids here.

Rayfin embed is **browser MSAL** + `@microsoft/rayfin-embed-host` (see [`fabric-rayfin/README.md`](../src/modules/reports/providers/fabric-rayfin/README.md)). The portal rejects Fabric catalog ids on [`/api/embed/token`](../src/app/api/embed/token/route.ts) before calling this function.

## Request body (from portal)

| Field | Description |
| --- | --- |
| `workspaceId` | Power BI workspace GUID |
| `reportId` | Power BI report GUID |
| `datasetId` | Optional; resolved from report if omitted |
| `username` | Signed-in user UPN/email (RLS effective identity) |
| `roles` | Power BI RLS role names from portal DB |
| `skipIdentity` | When `true`, mint a token **without** `identities` (System Admin / RLS bypass on RLS reports). When `false`, attach `username` + optional `roles` |
| `applyDatasourceIdentity` | When `true` with `skipIdentity`, attach `username` (+ `identityBlob` if `PBI_DATASOURCE_SCOPE` set) for Live/DQ datasets |
| `effectiveIdentity` | Optional alias `{ username, roles, datasets }` for older callers |

## App settings

- `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET` — embed service principal
- Optional `PBI_DATASOURCE_SCOPE` — e.g. `https://database.windows.net/.default` for DirectQuery SSO `identityBlob`
- Optional `PBI_DEFAULT_RLS_ROLES` / `PBI_ROLE_MAP_JSON` — **fallback only** when body `roles` is empty and dataset requires roles
- Optional `ALLOWED_ORIGIN` — CORS for browser callers (portal uses server-side POST)
- Do **not** enable Easy Auth on this function, or set **Authorization level: Function** + **Allow anonymous** on the app

## Paste-ready function (`index.js` or single file)

```javascript
const axios = require("axios");
const { ConfidentialClientApplication } = require("@azure/msal-node");

const PBI_API = "https://api.powerbi.com/v1.0/myorg";
const PBI_SCOPE = "https://analysis.windows.net/powerbi/api/.default";

let cca;
function getCca() {
  if (!cca) {
    cca = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.PBI_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.PBI_TENANT_ID}`,
        clientSecret: process.env.PBI_CLIENT_SECRET,
      },
    });
  }
  return cca;
}

async function getToken(scope) {
  const res = await getCca().acquireTokenByClientCredential({ scopes: [scope] });
  return res.accessToken;
}

function resolveRolesFromEnv(username) {
  try {
    if (process.env.PBI_ROLE_MAP_JSON) {
      const map = JSON.parse(process.env.PBI_ROLE_MAP_JSON);
      const key = Object.keys(map).find((k) => k.toLowerCase() === username.toLowerCase());
      if (key) return map[key];
    }
  } catch (_) {
    /* ignore */
  }
  return (process.env.PBI_DEFAULT_RLS_ROLES || "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
}

function needsWorkspaceIdentity(errMsg) {
  const u = String(errMsg || "").toUpperCase();
  return u.includes("PREMIUM_ASWL") || String(errMsg || "").toLowerCase().includes("workspace identity");
}

function needsEffectiveIdentity(errMsg) {
  return String(errMsg || "").toLowerCase().includes("effective identity");
}

function readPortalIdentity(body) {
  const eff = body.effectiveIdentity || {};
  const username = (body.username || eff.username || "").trim();
  const roles = Array.isArray(body.roles)
    ? body.roles.map((r) => String(r).trim()).filter(Boolean)
  : Array.isArray(eff.roles)
      ? eff.roles.map((r) => String(r).trim()).filter(Boolean)
      : [];
  const skipIdentity = body.skipIdentity === true;
  return { username, roles, skipIdentity, datasets: eff.datasets };
}

async function generateOnce(auth, tokenBody) {
  return (await axios.post(`${PBI_API}/GenerateToken`, tokenBody, auth)).data;
}

module.exports = async function (context, req) {
  const headers = corsHeaders();

  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers };
    return;
  }

  try {
    const body = req.body || {};
    const { workspaceId, reportId } = body;
    if (!workspaceId || !reportId) {
      context.res = {
        status: 400,
        headers,
        body: { success: false, error: "workspaceId and reportId are required." },
      };
      return;
    }

    const portal = readPortalIdentity(body);
    let username = portal.username;
    if (!username && process.env.PBI_FALLBACK_RLS_USER) {
      username = process.env.PBI_FALLBACK_RLS_USER;
      context.log.warn("No username in body; using PBI_FALLBACK_RLS_USER.");
    }
    if (!username && !portal.skipIdentity) {
      context.res = {
        status: 400,
        headers,
        body: {
          success: false,
          error: "username is required when the dataset needs an effective identity (portal must send signed-in email).",
        },
      };
      return;
    }

    const accessToken = await getToken(PBI_SCOPE);
    const auth = { headers: { Authorization: `Bearer ${accessToken}` } };

    let report;
    try {
      report = (await axios.get(`${PBI_API}/groups/${workspaceId}/reports/${reportId}`, auth)).data;
    } catch (err) {
      const status = err.response?.status;
      const code = err.response?.data?.error?.code || "";
      if (status === 404 || String(code).includes("PowerBIEntityNotFound")) {
        context.res = {
          status: 404,
          headers,
          body: {
            success: false,
            error:
              "BI_Portal_Auth supports Power BI reports only. This workspace/report id was not found (Fabric Rayfin apps use portal MSAL embed, not this API).",
            code: code || "PowerBIEntityNotFound",
          },
        };
        return;
      }
      throw err;
    }
    const datasetId = body.datasetId || report.datasetId;
    const datasetWorkspaceId = report.datasetWorkspaceId || workspaceId;

    const dataset = (await axios.get(`${PBI_API}/groups/${datasetWorkspaceId}/datasets/${datasetId}`, auth)).data;
    const identityRequired = !!dataset.isEffectiveIdentityRequired;
    const rolesRequired = !!dataset.isEffectiveIdentityRolesRequired;

    const applyDatasourceIdentity = body.applyDatasourceIdentity === true;

    const attachIdentity = (opts) => {
      const tokenBody = {
        reports: [{ id: reportId }],
        datasets: [{ id: datasetId }],
        targetWorkspaces: [{ id: workspaceId }],
        lifetimeInMinutes: 60,
      };
      if (opts.datasourceOnly) {
        const identity = { username, datasets: [datasetId] };
        tokenBody.identities = [identity];
        return { error: null, tokenBody, roles: [], datasourceOnly: true };
      }

      let roles = portal.roles;
      if (rolesRequired && !roles.length) {
        roles = resolveRolesFromEnv(username);
      }

      const identity = { username, datasets: [datasetId] };
      if (roles.length) identity.roles = roles;
      tokenBody.identities = [identity];
      return { error: null, tokenBody, roles, datasourceOnly: false };
    };

  let plan;
  if (portal.skipIdentity === true) {
    plan = {
      error: null,
      tokenBody: {
        reports: [{ id: reportId }],
        datasets: [{ id: datasetId }],
        targetWorkspaces: [{ id: workspaceId }],
        lifetimeInMinutes: 60,
      },
      roles: [],
    };
  } else if (Boolean(username)) {
    plan = attachIdentity({ datasourceOnly: false });
  } else if (identityRequired && applyDatasourceIdentity && username) {
    plan = attachIdentity({ datasourceOnly: true });
  } else {
    plan = {
      error: null,
      tokenBody: {
        reports: [{ id: reportId }],
        datasets: [{ id: datasetId }],
        targetWorkspaces: [{ id: workspaceId }],
        lifetimeInMinutes: 60,
      },
      roles: [],
    };
  }

    if (plan.tokenBody?.identities?.[0] && process.env.PBI_DATASOURCE_SCOPE) {
      plan.tokenBody.identities[0].identityBlob = await getToken(process.env.PBI_DATASOURCE_SCOPE);
    }

    let embed;
    let finalPlan = plan;
  let appliedRoles = plan.roles || [];
    try {
      embed = await generateOnce(auth, plan.tokenBody);
    } catch (err) {
      const detail = err.response?.data;
      const msg = JSON.stringify(detail || err.message || "");

      const hadIdentity = Boolean(plan.tokenBody?.identities?.length);
      if (!hadIdentity && needsEffectiveIdentity(msg) && username && portal.skipIdentity !== true) {
        const retry = attachIdentity({ datasourceOnly: false });
        if (retry.tokenBody?.identities?.[0] && process.env.PBI_DATASOURCE_SCOPE) {
          retry.tokenBody.identities[0].identityBlob = await getToken(process.env.PBI_DATASOURCE_SCOPE);
        }
        embed = await generateOnce(auth, retry.tokenBody);
        finalPlan = retry;
        appliedRoles = retry.roles || [];
      } else {
        throw err;
      }
    }

    context.res = {
      status: 200,
      headers,
      body: {
        success: true,
        workspaceId,
        reportId,
        reportName: report.name,
        embedUrl: report.embedUrl,
        embedToken: embed.token,
        expiration: embed.expiration,
        security: {
          rlsApplied: Boolean(finalPlan.tokenBody?.identities?.length),
          roles: appliedRoles,
          datasourceOnly: Boolean(finalPlan.datasourceOnly),
        },
      },
    };
  } catch (err) {
    const detail = err.response?.data;
    context.log.error("Embed token error:", detail || err.message);
    context.res = {
      status: err.response?.status || 500,
      headers,
      body: {
        success: false,
        error: detail?.error?.message || err.message,
        code: detail?.error?.code,
      },
    };
  }
};
```

## Portal reference

- Payload builder: [`src/lib/azure-embed/function-client.ts`](../src/lib/azure-embed/function-client.ts) (`buildD360EmbedBody`)
- RLS roles from DB: [`src/lib/catalog/rls-access.ts`](../src/lib/catalog/rls-access.ts)
- Token route: [`src/app/api/embed/token/route.ts`](../src/app/api/embed/token/route.ts)
