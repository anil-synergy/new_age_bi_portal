import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PUT } from "./route";

const mockHandleBiFavorite = vi.fn();

vi.mock("@/lib/server/bi-favorites", () => ({
  handleBiFavorite: (...args: unknown[]) => mockHandleBiFavorite(...args),
}));

describe("PUT /api/catalog/favorites", () => {
  beforeEach(() => {
    mockHandleBiFavorite.mockReset();
    mockHandleBiFavorite.mockResolvedValue(
      new Response(JSON.stringify([{ id: "r1", favorite: true }]), { status: 200 }),
    );
  });

  it("delegates to handleBiFavorite", async () => {
    const request = new NextRequest(
      "http://localhost/api/catalog/favorites?reportId=00000000-0000-4000-8000-000000000001",
      { method: "PUT", headers: { Authorization: "Bearer tok" } },
    );
    const res = await PUT(request);
    expect(mockHandleBiFavorite).toHaveBeenCalledWith(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]?.favorite).toBe(true);
  });
});
