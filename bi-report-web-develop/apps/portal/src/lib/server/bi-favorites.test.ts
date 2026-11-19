import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { handleBiFavorite, isBiFavoritePath } from "./bi-favorites";

const mockEmailFromBearer = vi.fn();
const mockLoadCatalog = vi.fn();
const mockInvalidate = vi.fn();
const mockToggle = vi.fn();

vi.mock("@/lib/catalog/entra-user", () => ({
  emailFromBearer: (...args: unknown[]) => mockEmailFromBearer(...args),
}));

vi.mock("@/lib/catalog/reports-catalog", () => ({
  loadCatalogForEmail: (...args: unknown[]) => mockLoadCatalog(...args),
  invalidateCatalogCache: (...args: unknown[]) => mockInvalidate(...args),
  toggleFavoriteForUser: (...args: unknown[]) => mockToggle(...args),
}));

describe("isBiFavoritePath", () => {
  it("matches PUT favoriteReport only", () => {
    expect(isBiFavoritePath("PUT", ["bi-report-api", "v1", "report", "favoriteReport"])).toBe(true);
    expect(isBiFavoritePath("GET", ["bi-report-api", "v1", "report", "favoriteReport"])).toBe(false);
    expect(isBiFavoritePath("PUT", ["bi-report-api", "v1", "report", "reports"])).toBe(false);
  });
});

describe("handleBiFavorite", () => {
  beforeEach(() => {
    mockEmailFromBearer.mockReset();
    mockLoadCatalog.mockReset();
    mockInvalidate.mockReset();
    mockToggle.mockReset();
  });

  it("returns 401 without authorization", async () => {
    mockEmailFromBearer.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/bi/bi-report-api/v1/report/favoriteReport?reportId=00000000-0000-4000-8000-000000000001");
    const res = await handleBiFavorite(request);
    expect(res.status).toBe(401);
    expect(mockToggle).not.toHaveBeenCalled();
  });

  it("returns 400 when reportId is missing", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    const request = new NextRequest("http://localhost/api/bi/bi-report-api/v1/report/favoriteReport", {
      headers: { Authorization: "Bearer t" },
    });
    const res = await handleBiFavorite(request);
    expect(res.status).toBe(400);
  });

  it("returns 401 when user is not in catalog", async () => {
    mockEmailFromBearer.mockResolvedValue("unknown@example.com");
    mockLoadCatalog.mockResolvedValue({ userFound: false, userInfo: { group: [] }, reports: [] });
    const request = new NextRequest(
      "http://localhost/api/bi/bi-report-api/v1/report/favoriteReport?reportId=00000000-0000-4000-8000-000000000001",
      { headers: { Authorization: "Bearer t" } },
    );
    const res = await handleBiFavorite(request);
    expect(res.status).toBe(401);
  });

  it("toggles favorite and returns refreshed reports", async () => {
    mockEmailFromBearer.mockResolvedValue("user@example.com");
    mockLoadCatalog
      .mockResolvedValueOnce({
        userFound: true,
        userInfo: { id: "u1", name: "User", group: [] },
        reports: [],
      })
      .mockResolvedValueOnce({
        userFound: true,
        userInfo: { id: "u1", name: "User", group: [] },
        reports: [{ id: "r1", title: "R", name: "R", favorite: true }],
      });
    mockToggle.mockResolvedValue(undefined);
    const request = new NextRequest(
      "http://localhost/api/bi/bi-report-api/v1/report/favoriteReport?reportId=00000000-0000-4000-8000-000000000001",
      { headers: { Authorization: "Bearer t" } },
    );
    const res = await handleBiFavorite(request);
    expect(res.status).toBe(200);
    expect(mockToggle).toHaveBeenCalledWith("u1", "User", "00000000-0000-4000-8000-000000000001");
    expect(mockInvalidate).toHaveBeenCalledWith("user@example.com");
    const body = await res.json();
    expect(body[0].favorite).toBe(true);
  });
});
