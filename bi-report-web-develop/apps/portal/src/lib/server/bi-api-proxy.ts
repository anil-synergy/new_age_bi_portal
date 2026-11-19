import { NextRequest, NextResponse } from "next/server";
import { handleBiHealth, isBiHealthPath } from "@/lib/server/bi-health";
import { handleBiCatalogRead, isBiCatalogReadPath } from "@/lib/server/bi-catalog-reads";
import { handleBiFavorite, isBiFavoritePath } from "@/lib/server/bi-favorites";
import { handleBiDownloadPost, handleBiEmbedGet, isBiDownloadPath, isBiEmbedPath } from "@/lib/server/bi-embed";
import { handleBiAdmin, isBiAdminPath } from "@/lib/server/bi-admin";
import { handleBiSemanticModel, isBiSemanticModelPath } from "@/lib/server/bi-semantic-model";

export async function proxyBiRequest(request: NextRequest, path: string[]): Promise<NextResponse> {
  if (isBiHealthPath(path)) {
    return handleBiHealth(path);
  }
  if (isBiCatalogReadPath(request.method, path)) {
    return handleBiCatalogRead(request, path);
  }
  if (isBiFavoritePath(request.method, path)) {
    return handleBiFavorite(request);
  }
  if (isBiEmbedPath(request.method, path)) {
    return handleBiEmbedGet(request, path);
  }
  if (isBiDownloadPath(request.method, path)) {
    return handleBiDownloadPost(request, path);
  }
  if (isBiAdminPath(request.method, path)) {
    return handleBiAdmin(request, path);
  }
  if (isBiSemanticModelPath(request.method, path)) {
    return handleBiSemanticModel(request, path);
  }

  return NextResponse.json({ message: "Not found" }, { status: 404 });
}
