import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { requestPortalEmbedToken } from "./embed-token-issue";

const mockRequestFn = vi.fn();

vi.mock("./function-client", () => ({
  requestEmbedToken: (...args: unknown[]) => mockRequestFn(...args),
}));

describe("requestPortalEmbedToken", () => {
  const base = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    reportId: "22222222-2222-4222-8222-222222222222",
    username: "user@example.com",
    roles: [] as string[],
  };

  beforeEach(() => {
    mockRequestFn.mockReset();
    vi.stubEnv("AZURE_FUNCTION_BASE", "https://fn.test/api");
    mockRequestFn.mockResolvedValue({
      embedUrl: "https://fn-embed",
      accessToken: "fn-tok",
      reportId: base.reportId,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts inactive sample: skipIdentity true without effectiveIdentity", async () => {
    await requestPortalEmbedToken({
      ...base,
      skipIdentity: true,
      datasetId: "33333333-3333-4333-8333-333333333333",
    });
    expect(mockRequestFn).toHaveBeenCalledWith(
      expect.objectContaining({
        username: base.username,
        roles: [],
        skipIdentity: true,
        effectiveIdentity: undefined,
      }),
    );
    const body = mockRequestFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.applyDatasourceIdentity).toBeUndefined();
  });

  it("posts active RLS sample with effectiveIdentity", async () => {
    const ds = "33333333-3333-4333-8333-333333333333";
    await requestPortalEmbedToken({
      ...base,
      datasetId: ds,
      roles: ["BS_User"],
      skipIdentity: false,
      effectiveIdentity: { username: base.username, roles: ["BS_User"], datasets: [ds] },
    });
    expect(mockRequestFn).toHaveBeenCalledWith(
      expect.objectContaining({
        skipIdentity: false,
        effectiveIdentity: { username: base.username, roles: ["BS_User"], datasets: [ds] },
      }),
    );
  });

  it("retries with RLS roles when first call skips identity but Function requires effective identity", async () => {
    const ds = "33333333-3333-4333-8333-333333333333";
    mockRequestFn
      .mockRejectedValueOnce(new Error("Effective identity is required for this dataset"))
      .mockResolvedValueOnce({
        embedUrl: "https://fn-embed",
        accessToken: "fn-tok-2",
        reportId: base.reportId,
      });

    await requestPortalEmbedToken({
      ...base,
      datasetId: ds,
      skipIdentity: true,
      rlsRolesForIdentityRetry: ["BS_User", "BS_Admin"],
    });

    expect(mockRequestFn).toHaveBeenCalledTimes(2);
    expect(mockRequestFn.mock.calls[1]?.[0]).toMatchObject({
      skipIdentity: false,
      roles: ["BS_User", "BS_Admin"],
      effectiveIdentity: {
        username: base.username,
        roles: ["BS_User", "BS_Admin"],
        datasets: [ds],
      },
    });
  });

  it("requires AZURE_FUNCTION_BASE", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("AZURE_FUNCTION_BASE", "");
    vi.stubEnv("NEXT_PUBLIC_AZURE_FUNCTION_BASE", "");
    await expect(requestPortalEmbedToken(base)).rejects.toThrow(/AZURE_FUNCTION_BASE/);
  });
});
