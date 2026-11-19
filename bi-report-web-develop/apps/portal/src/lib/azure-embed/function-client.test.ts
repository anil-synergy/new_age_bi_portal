import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildD360EmbedBody, requestEmbedToken } from "./function-client";
import { FUNCTION_APP_AUTH_HINT } from "./errors";

describe("buildD360EmbedBody", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const reportId = "22222222-2222-4222-8222-222222222222";
  const datasetId = "33333333-3333-4333-8333-333333333333";

  it("includes flat username, roles, and skipIdentity", () => {
    const body = buildD360EmbedBody({
      workspaceId,
      reportId,
      datasetId,
      embedType: "report",
      username: "u@x.com",
      roles: ["BS_User"],
      skipIdentity: false,
      effectiveIdentity: { username: "u@x.com", roles: ["BS_User"], datasets: [datasetId] },
    });
    expect(body).toMatchObject({
      workspaceId,
      reportId,
      datasetId,
      username: "u@x.com",
      roles: ["BS_User"],
      skipIdentity: false,
    });
    expect(body.effectiveIdentity).toEqual({
      username: "u@x.com",
      roles: ["BS_User"],
      datasets: [datasetId],
    });
  });

  it("defaults skipIdentity to false when username is present without effectiveIdentity", () => {
    const body = buildD360EmbedBody({
      workspaceId,
      reportId,
      embedType: "report",
      username: "u@x.com",
      roles: [],
    });
    expect(body.skipIdentity).toBe(false);
    expect(body.roles).toEqual([]);
  });

  it("sets skipIdentity true when username and effectiveIdentity are omitted", () => {
    const body = buildD360EmbedBody({
      workspaceId,
      reportId,
      embedType: "report",
      roles: [],
      skipIdentity: true,
    });
    expect(body.skipIdentity).toBe(true);
  });

  it("active RLS Creworks sample shape with session UPN and DB roles", () => {
    const creworksWs = "0e5a1b9d-30ec-48e3-8639-1dc6e6fa81bd";
    const creworksReport = "5320e04a-086f-41d0-b7f5-7b478652ee9f";
    const creworksDs = "f62d3080-c0b2-459e-a34b-6eafdff15f2a";
    const upn = "anilkumar.c@synergyship.com";
    const body = buildD360EmbedBody({
      workspaceId: creworksWs,
      reportId: creworksReport,
      datasetId: creworksDs,
      embedType: "report",
      username: upn,
      roles: ["Bluelink Users"],
      skipIdentity: false,
      effectiveIdentity: {
        username: upn,
        roles: ["Bluelink Users"],
        datasets: [creworksDs],
      },
    });
    expect(body).toEqual({
      workspaceId: creworksWs,
      reportId: creworksReport,
      datasetId: creworksDs,
      username: upn,
      roles: ["Bluelink Users"],
      skipIdentity: false,
      effectiveIdentity: {
        username: upn,
        roles: ["Bluelink Users"],
        datasets: [creworksDs],
      },
    });
  });

  it("inactive sample: skipIdentity true omits effectiveIdentity from Function body", () => {
    const body = buildD360EmbedBody({
      workspaceId,
      reportId,
      datasetId,
      embedType: "report",
      username: "anilkumar.c@synergyship.com",
      roles: [],
      skipIdentity: true,
      effectiveIdentity: { username: "anilkumar.c@synergyship.com", roles: [], datasets: [datasetId] },
    });
    expect(body.skipIdentity).toBe(true);
    expect(body.roles).toEqual([]);
    expect(body.effectiveIdentity).toBeUndefined();
    expect(body).not.toHaveProperty("applyDatasourceIdentity");
  });
});

describe("requestEmbedToken", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const reportId = "22222222-2222-4222-8222-222222222222";
  const datasetId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.stubEnv("AZURE_FUNCTION_BASE", "https://fn.test/api");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          embedUrl: "https://embed",
          accessToken: "tok",
        }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POSTs flat portal contract to BI_Portal_Auth", async () => {
    await requestEmbedToken({
      workspaceId,
      reportId,
      datasetId,
      embedType: "report",
      username: "u@x.com",
      roles: ["BS_User"],
      skipIdentity: false,
      effectiveIdentity: { username: "u@x.com", roles: ["BS_User"], datasets: [datasetId] },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("BI_Portal_Auth");
    const body = JSON.parse(String(init.body));
    expect(body.username).toBe("u@x.com");
    expect(body.roles).toEqual(["BS_User"]);
    expect(body.skipIdentity).toBe(false);
    expect(body.datasetId).toBe(datasetId);
  });

  it("uses AZURE_EMBED_FUNCTION_PATH when set", async () => {
    vi.stubEnv("AZURE_EMBED_FUNCTION_PATH", "Custom_Embed_Auth");
    await requestEmbedToken({
      workspaceId,
      reportId,
      embedType: "report",
      skipIdentity: true,
    });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("Custom_Embed_Auth");
  });

  it("maps HTML Easy Auth 401 to function auth hint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "<html><body>You do not have permission to view this directory or page.</body></html>",
    }) as unknown as typeof fetch;

    await expect(
      requestEmbedToken({
        workspaceId,
        reportId,
        embedType: "report",
        skipIdentity: true,
      }),
    ).rejects.toThrow(FUNCTION_APP_AUTH_HINT);
  });

  it("surfaces JSON function errors on 401 instead of Easy Auth hint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ success: false, error: "Caller identity not found" }),
    }) as unknown as typeof fetch;

    await expect(
      requestEmbedToken({
        workspaceId,
        reportId,
        embedType: "report",
        username: "u@x.com",
        skipIdentity: false,
      }),
    ).rejects.toThrow(/Caller identity not found|Failed/);
  });
});
