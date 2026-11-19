import { describe, expect, it } from "vitest";
import {
  describeEmbedError,
  ensureEmbedUserMessage,
  extractPowerBiRequestId,
  formatEmbedUserMessage,
  FUNCTION_APP_AUTH_HINT,
  isFunctionAppAuthBlocked,
  isFunctionKeyRejected,
} from "./errors";

describe("formatEmbedUserMessage", () => {
  it("maps PREMIUM_ASWL to workspace identity hint, not RLS mapping", () => {
    const msg = formatEmbedUserMessage("PREMIUM_ASWL_ERROR: workspace identity");
    expect(msg.toLowerCase()).toContain("workspace identity");
    expect(msg.toLowerCase()).not.toContain("map the signed-in user");
  });

  it("extracts requestId from technicalDetails", () => {
    expect(extractPowerBiRequestId({ requestId: "395e917d-b156-4245-8882-45d51ec18391" })).toBe(
      "395e917d-b156-4245-8882-45d51ec18391",
    );
    expect(extractPowerBiRequestId('{"requestId":"ffa1ce3a-e80e-41b9-8dce-ccbc72fa00f3"}')).toBe(
      "ffa1ce3a-e80e-41b9-8dce-ccbc72fa00f3",
    );
  });

  it("maps PREMIUM_ASWL on-prem errors to gateway guidance", () => {
    const msg = formatEmbedUserMessage(
      "Premium_ASWL_Error — An exception occurred due to an on premise service issue.",
    );
    expect(msg.toLowerCase()).toContain("on-premises data source");
    expect(msg.toLowerCase()).toContain("gateway");
  });

  it("maps effective identity errors to RLS guidance", () => {
    const msg = formatEmbedUserMessage("Export report requires effective identity to be provided");
    expect(msg.toLowerCase()).toContain("row-level security");
  });

  it("maps Easy Auth HTML to function auth hint", () => {
    const html = "You do not have permission to view this directory or page.";
    expect(isFunctionAppAuthBlocked(html, 401)).toBe(true);
    expect(formatEmbedUserMessage(html)).toBe(FUNCTION_APP_AUTH_HINT);
  });

  it("does not treat JSON 401 from the function as Easy Auth", () => {
    const json = JSON.stringify({ success: false, error: "username is required" });
    expect(isFunctionAppAuthBlocked(json, 401)).toBe(false);
  });

  it("detects invalid function key responses", () => {
    expect(isFunctionKeyRejected("Invalid function key", 401)).toBe(true);
  });
});

describe("describeEmbedError", () => {
  it("falls back when top-level message is empty", () => {
    const msg = describeEmbedError(
      { success: false, message: "", error: { code: "InvalidRequest", message: "Dataset not found" } },
      "",
    );
    expect(msg.toLowerCase()).toContain("dataset not found");
  });

  it("uses string error when message is empty", () => {
    const msg = describeEmbedError({ success: false, message: "", error: "token generation failed" }, "");
    expect(msg).toBe("token generation failed");
  });

  it("uses default when all fields are empty", () => {
    const msg = describeEmbedError({ success: false, message: "" }, "");
    expect(msg).toBe("Failed to fetch embed token");
  });
});

describe("ensureEmbedUserMessage", () => {
  it("returns fallback when formatted message is empty", () => {
    expect(ensureEmbedUserMessage("", "fallback text")).toBe("fallback text");
    expect(ensureEmbedUserMessage('{"message":""}', "fallback text")).toBe("fallback text");
  });
});
