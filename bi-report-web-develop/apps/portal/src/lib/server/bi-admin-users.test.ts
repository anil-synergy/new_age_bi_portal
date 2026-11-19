import { describe, expect, it, vi, beforeEach } from "vitest";
import { addUser } from "./bi-admin-users";

const mockInvalidate = vi.fn();
const queryMock = vi.fn();

vi.mock("./bi-admin-common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bi-admin-common")>();
  return {
    ...actual,
    invalidateAfterAdminWrite: (...args: unknown[]) => mockInvalidate(...args),
    getDb: () => ({
      query: queryMock,
      connect: async () => ({
        query: queryMock,
        release: vi.fn(),
      }),
    }),
  };
});

describe("addUser", () => {
  beforeEach(() => {
    mockInvalidate.mockReset();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it("invalidates catalog cache after a successful insert", async () => {
    const ctx = {
      email: "admin@example.com",
      userId: "admin-id",
      userName: "Admin",
      isSuperAdmin: true,
      isDepAdmin: false,
      departmentCategoryIds: [],
    };
    const res = await addUser(ctx, {
      name: "New",
      emailAddress: "new@example.com",
      group: [],
    });
    expect(res.status).toBe(200);
    expect(mockInvalidate).toHaveBeenCalledWith("admin@example.com");
  });
});
