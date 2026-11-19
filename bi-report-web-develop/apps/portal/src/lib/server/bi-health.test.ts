import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleBiHealth, isBiHealthPath } from "./bi-health";

const mockQuery = vi.fn();

vi.mock("@/lib/catalog/dev-db", () => ({
  getDevDbPool: () => ({ query: mockQuery }),
}));

describe("isBiHealthPath", () => {
  it("matches ping, health, and health/ready under bi-report-api/v1", () => {
    expect(isBiHealthPath(["bi-report-api", "v1", "ping"])).toBe(true);
    expect(isBiHealthPath(["bi-report-api", "v1", "health"])).toBe(true);
    expect(isBiHealthPath(["bi-report-api", "v1", "health", "ready"])).toBe(true);
  });

  it("rejects other paths", () => {
    expect(isBiHealthPath(["bi-report-api", "v1", "report", "reports"])).toBe(false);
    expect(isBiHealthPath(["v1", "ping"])).toBe(false);
    expect(isBiHealthPath(["bi-report-api", "v2", "ping"])).toBe(false);
  });
});

describe("handleBiHealth", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns 200 plain text for ping and health without touching the database", async () => {
    for (const suffix of ["ping", "health"] as const) {
      const path = ["bi-report-api", "v1", suffix];
      const res = await handleBiHealth(path);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("BI Portal (Next.js)");
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 200 Healthy when SELECT 1 succeeds", async () => {
    mockQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const res = await handleBiHealth(["bi-report-api", "v1", "health", "ready"]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Healthy");
    expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns 503 Unhealthy when the pool query fails", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    const res = await handleBiHealth(["bi-report-api", "v1", "health", "ready"]);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Unhealthy");
  });
});
