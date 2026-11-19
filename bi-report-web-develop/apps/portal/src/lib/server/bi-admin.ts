import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireCatalogUser, requireSystemAdmin } from "./bi-admin-auth";
import {
  handleCategoriesDelete,
  handleCategoriesGet,
  handleCategoriesPost,
  handleCategoriesPut,
} from "./bi-admin-categories";
import {
  handleDisplayAdminDelete,
  handleDisplayAdminGet,
  handleDisplayAdminPost,
  handleDisplayAdminPut,
  handleDisplayGetById,
} from "./bi-admin-display";
import {
  handleGroupsDelete,
  handleGroupsGet,
  handleGroupsPost,
  handleGroupsPut,
} from "./bi-admin-groups";
import { handlePagesGet, handlePagesPut } from "./bi-admin-pages";
import {
  handleReportsDelete,
  handleReportsGet,
  handleReportsPost,
  handleReportsPut,
} from "./bi-admin-reports";
import {
  handleUsersDelete,
  handleUsersGet,
  handleUsersPost,
  handleUsersPut,
} from "./bi-admin-users";

const ADMIN_ROOT = "bi-report-api/v1/admin";

/** Routes implemented in Next (AdminController parity + Phase 6). Unknown admin paths 404. */
const ADMIN_ROUTES: Array<{ methods: string[]; pattern: RegExp; systemAdmin?: boolean }> = [
  { methods: ["POST"], pattern: /^admin\/users$/ },
  { methods: ["POST"], pattern: /^admin\/users\/bulk$/ },
  { methods: ["GET"], pattern: /^admin\/users\/email$/ },
  { methods: ["POST"], pattern: /^admin\/user$/ },
  { methods: ["PUT"], pattern: /^admin\/user\/[^/]+$/, systemAdmin: true },
  { methods: ["GET"], pattern: /^admin\/user\/[^/]+$/, systemAdmin: true },
  { methods: ["DELETE"], pattern: /^admin\/user\/[^/]+$/, systemAdmin: true },
  { methods: ["GET"], pattern: /^admin\/allUsers$/ },
  { methods: ["GET"], pattern: /^admin\/role$/ },
  { methods: ["GET"], pattern: /^admin\/user\/group$/ },
  { methods: ["POST"], pattern: /^admin\/user\/group$/ },
  { methods: ["PUT"], pattern: /^admin\/user\/group\/[^/]+$/ },
  { methods: ["DELETE"], pattern: /^admin\/user\/group\/[^/]+$/, systemAdmin: true },
  { methods: ["POST"], pattern: /^admin\/user\/group\/[^/]+\/users$/ },
  { methods: ["DELETE"], pattern: /^admin\/user\/group\/[^/]+\/users$/ },
  { methods: ["POST"], pattern: /^admin\/getAllReports$/ },
  { methods: ["POST"], pattern: /^admin\/reports$/ },
  { methods: ["PUT"], pattern: /^admin\/reports\/[^/]+$/ },
  { methods: ["GET"], pattern: /^admin\/reports\/[^/]+$/ },
  { methods: ["DELETE"], pattern: /^admin\/reports\/[^/]+$/ },
  { methods: ["POST"], pattern: /^admin\/reports\/[^/]+\/permission\/group\/[^/]+$/ },
  { methods: ["POST"], pattern: /^admin\/reports\/[^/]+\/permission\/user\/[^/]+$/ },
  { methods: ["DELETE"], pattern: /^admin\/reports\/permission\/group$/ },
  { methods: ["DELETE"], pattern: /^admin\/reports\/permission\/user$/ },
  { methods: ["GET"], pattern: /^admin\/report\/category$/ },
  { methods: ["POST"], pattern: /^admin\/report\/category$/, systemAdmin: true },
  { methods: ["PUT"], pattern: /^admin\/report\/category\/[^/]+$/, systemAdmin: true },
  { methods: ["GET"], pattern: /^admin\/report\/categories$/ },
  { methods: ["DELETE"], pattern: /^admin\/report\/category\/[^/]+$/, systemAdmin: true },
  { methods: ["GET"], pattern: /^admin\/display-reports$/ },
  { methods: ["POST"], pattern: /^admin\/display-reports$/ },
  { methods: ["GET"], pattern: /^admin\/display-reports\/[^/]+$/ },
  { methods: ["PUT"], pattern: /^admin\/display-reports\/[^/]+$/ },
  { methods: ["DELETE"], pattern: /^admin\/display-reports\/[^/]+$/ },
  { methods: ["GET"], pattern: /^admin\/reports\/[^/]+\/pages$/ },
  { methods: ["PUT"], pattern: /^admin\/reports\/[^/]+\/pages$/ },
];

function adminSuffix(path: string[]): string | null {
  if (path.length < 3) return null;
  if (path[0] !== "bi-report-api" || path[1] !== "v1" || path[2] !== "admin") return null;
  return path.slice(2).join("/");
}

export function isBiAdminPath(method: string, path: string[]): boolean {
  const suffix = adminSuffix(path);
  if (!suffix) return false;
  return ADMIN_ROUTES.some((route) => route.methods.includes(method) && route.pattern.test(suffix));
}

function needsSystemAdmin(method: string, suffix: string): boolean {
  const hit = ADMIN_ROUTES.find((route) => route.methods.includes(method) && route.pattern.test(suffix));
  return Boolean(hit?.systemAdmin);
}

export async function handleBiAdmin(request: NextRequest, path: string[]): Promise<NextResponse> {
  const suffix = adminSuffix(path);
  if (!suffix) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const subpath = suffix.replace(/^admin\//, "");
  const method = request.method;

  const displayById = subpath.match(/^display-reports\/([^/]+)$/);
  if (method === "GET" && displayById) {
    const viewer = await requireCatalogUser(request);
    if (viewer instanceof NextResponse) return viewer;
    try {
      return await handleDisplayGetById(viewer, displayById[1]);
    } catch (error) {
      const err = error as Error & { code?: string };
      console.error(`[admin] ${request.method} ${suffix} failed: ${err.code ?? err.name}: ${err.message}`);
      return NextResponse.json(
        {
          message: "Admin request failed.",
          detail: process.env.NODE_ENV === "development" ? err.message : undefined,
          code: err.code,
        },
        { status: 500 },
      );
    }
  }

  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  if (needsSystemAdmin(method, suffix)) {
    const denied = requireSystemAdmin(auth);
    if (denied) return denied;
  }

  try {
    if (method === "GET") {
      const handlers = [
        () => handleDisplayAdminGet(auth, subpath),
        () => handlePagesGet(auth, subpath),
        () => handleGroupsGet(auth, request, subpath),
        () => handleUsersGet(auth, subpath),
        () => handleCategoriesGet(auth, request, subpath),
        () => handleReportsGet(auth, subpath),
      ];
      for (const run of handlers) {
        const res = await run();
        if (res) return res;
      }
    } else if (method === "POST") {
      const handlers = [
        () => handleDisplayAdminPost(auth, request, subpath),
        () => handleUsersPost(auth, request, subpath),
        () => handleGroupsPost(auth, request, subpath),
        () => handleCategoriesPost(auth, request, subpath),
        () => handleReportsPost(auth, request, subpath),
      ];
      for (const run of handlers) {
        const res = await run();
        if (res) return res;
      }
    } else if (method === "PUT") {
      const handlers = [
        () => handleDisplayAdminPut(auth, request, subpath),
        () => handlePagesPut(auth, request, subpath),
        () => handleUsersPut(auth, subpath, request),
        () => handleGroupsPut(auth, request, subpath),
        () => handleCategoriesPut(auth, request, subpath),
        () => handleReportsPut(auth, request, subpath),
      ];
      for (const run of handlers) {
        const res = await run();
        if (res) return res;
      }
    } else if (method === "DELETE") {
      const handlers = [
        () => handleDisplayAdminDelete(auth, subpath),
        () => handleUsersDelete(auth, subpath),
        () => handleGroupsDelete(auth, request, subpath),
        () => handleCategoriesDelete(auth, subpath),
        () => handleReportsDelete(auth, request, subpath),
      ];
      for (const run of handlers) {
        const res = await run();
        if (res) return res;
      }
    }

    return NextResponse.json({ message: "Not found" }, { status: 404 });
  } catch (error) {
    const err = error as Error & { code?: string };
    console.error(`[admin] ${request.method} ${path.join("/")} failed: ${err.code ?? err.name}: ${err.message}`);
    return NextResponse.json(
      {
        message: "Admin request failed.",
        detail: process.env.NODE_ENV === "development" ? err.message : undefined,
        code: err.code,
      },
      { status: 500 },
    );
  }
}

export { ADMIN_ROOT };
