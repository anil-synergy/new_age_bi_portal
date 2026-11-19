import { describe, expect, it, vi, afterEach } from "vitest";
import {
  EmbedMissingRlsConfigError,
  embedUsernameForLiveDq,
  embedUsernameFromSession,
  resolveEmbedPayloadPolicy,
} from "./embed-payload-policy";

const HAWKEYE_SP_APP_ID = "7c79b1ca-ef70-493c-923b-2965469b1c40";
const HAWKEYE_SP_OBJECT_ID = "bca0a39b-333d-4386-8be5-a48f697edfac";
const internalAuditDs = "5a342526-b7ab-4da0-a43e-9c772cdefbba";
const creworksDs = "f62d3080-c0b2-459e-a34b-6eafdff15f2a";
const docCertificateDs = "2e33f17a-0b33-4d3a-9441-69ed9aebc017";
const upn = "anilkumar.c@synergyship.com";

describe("resolveEmbedPayloadPolicy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DOC Certificate uses Live/DQ identity by default for a signed-in user", () => {
    vi.stubEnv("PBI_EMBED_SP_CLIENT_ID", HAWKEYE_SP_APP_ID);
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: upn,
      roles: [],
      datasetId: docCertificateDs,
      isSuperAdmin: false,
      rlsEnabled: false,
    });
    expect(policy).toEqual({
      username: upn,
      roles: [],
      skipIdentity: false,
      applyDatasourceIdentity: true,
      effectiveIdentity: {
        username: upn,
        roles: [],
        datasets: [docCertificateDs],
      },
    });
  });

  it("DOC Certificate System Admin uses Hawkeye SP app id in effectiveIdentity", () => {
    vi.stubEnv("PBI_EMBED_SP_CLIENT_ID", HAWKEYE_SP_APP_ID);
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: upn,
      roles: [],
      datasetId: docCertificateDs,
      isSuperAdmin: true,
      rlsEnabled: false,
    });
    expect(policy).toEqual({
      username: HAWKEYE_SP_APP_ID,
      roles: [],
      skipIdentity: false,
      applyDatasourceIdentity: true,
      effectiveIdentity: {
        username: HAWKEYE_SP_APP_ID,
        roles: [],
        datasets: [docCertificateDs],
      },
    });
  });

  it("RLS bypass user sends identity with all mapped roles", () => {
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: upn,
      roles: ["BS_User", "BS_Admin"],
      datasetId: "133a9eff-1512-4775-bbfd-b9008d84e9fa",
      rlsEnabled: true,
      isSuperAdmin: false,
      rlsBypassed: true,
    });
    expect(policy.skipIdentity).toBe(false);
    expect(policy.effectiveIdentity).toEqual({
      username: upn,
      roles: ["BS_User", "BS_Admin"],
      datasets: ["133a9eff-1512-4775-bbfd-b9008d84e9fa"],
    });
  });

  it("System Admin on RLS report sends UPN with all catalog roles", () => {
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: upn,
      roles: ["BS_User", "BS_Admin"],
      datasetId: creworksDs,
      rlsEnabled: true,
      isSuperAdmin: true,
    });
    expect(policy.skipIdentity).toBe(false);
    expect(policy.effectiveIdentity).toEqual({
      username: upn,
      roles: ["BS_User", "BS_Admin"],
      datasets: [creworksDs],
    });
  });

  it("RLS dataset with no roles is an error, never an identity-less token", () => {
    expect(() =>
      resolveEmbedPayloadPolicy({ signedInEmail: upn, roles: [], datasetId: "133a9eff-1512-4775-bbfd-b9008d84e9fa", rlsEnabled: true, isSuperAdmin: true }),
    ).toThrow(/RLS enabled/);
  });

  it("Live/DQ without UPN falls back to SP app id for non-admin", () => {
    vi.stubEnv("PBI_EMBED_SP_CLIENT_ID", HAWKEYE_SP_APP_ID);
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: "",
      roles: [],
      datasetId: docCertificateDs,
      isSuperAdmin: false,
      rlsEnabled: false,
    });
    expect(policy.username).toBe(HAWKEYE_SP_APP_ID);
    expect(policy.skipIdentity).toBe(false);
  });

  it("inactive RLS: session UPN, roles [], skipIdentity true, no effectiveIdentity", () => {
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: upn,
      roles: [],
      datasetId: internalAuditDs,
      isSuperAdmin: false,
      rlsEnabled: false,
    });
    expect(policy).toEqual({
      username: upn,
      roles: [],
      skipIdentity: true,
      effectiveIdentity: undefined,
    });
  });

  it("active RLS: UPN, roles, skipIdentity false, effectiveIdentity with datasets", () => {
    const policy = resolveEmbedPayloadPolicy({
      signedInEmail: upn,
      roles: ["Bluelink Users"],
      datasetId: creworksDs,
      isSuperAdmin: false,
      rlsEnabled: true,
    });
    expect(policy.username).toBe(upn);
    expect(policy.skipIdentity).toBe(false);
    expect(policy.effectiveIdentity).toEqual({
      username: upn,
      roles: ["Bluelink Users"],
      datasets: [creworksDs],
    });
  });

  it("throws when RLS on and user has no mapped roles", () => {
    expect(() =>
      resolveEmbedPayloadPolicy({
        signedInEmail: upn,
        roles: [],
        datasetId: creworksDs,
        isSuperAdmin: false,
        rlsEnabled: true,
      }),
    ).toThrow(EmbedMissingRlsConfigError);
  });

  it("embedUsernameFromSession uses SP App ID when UPN missing", () => {
    vi.stubEnv("PBI_EMBED_SP_CLIENT_ID", HAWKEYE_SP_APP_ID);
    expect(embedUsernameFromSession("")).toBe(HAWKEYE_SP_APP_ID);
    expect(embedUsernameFromSession("")).not.toBe(HAWKEYE_SP_OBJECT_ID);
  });

  it("embedUsernameForLiveDq picks UPN vs SP app id", () => {
    vi.stubEnv("PBI_EMBED_SP_CLIENT_ID", HAWKEYE_SP_APP_ID);
    expect(embedUsernameForLiveDq(upn, false)).toBe(upn);
    expect(embedUsernameForLiveDq(upn, true)).toBe(HAWKEYE_SP_APP_ID);
    expect(embedUsernameForLiveDq("", true)).toBe(HAWKEYE_SP_APP_ID);
  });
});