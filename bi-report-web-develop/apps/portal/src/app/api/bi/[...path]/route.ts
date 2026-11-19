import { NextRequest } from "next/server";
import { proxyBiRequest } from "@/lib/server/bi-api-proxy";

type RouteCtx = { params: { path: string[] } };

export function GET(request: NextRequest, ctx: RouteCtx) {
  return proxyBiRequest(request, ctx.params.path);
}
export function POST(request: NextRequest, ctx: RouteCtx) {
  return proxyBiRequest(request, ctx.params.path);
}
export function PUT(request: NextRequest, ctx: RouteCtx) {
  return proxyBiRequest(request, ctx.params.path);
}
export function PATCH(request: NextRequest, ctx: RouteCtx) {
  return proxyBiRequest(request, ctx.params.path);
}
export function DELETE(request: NextRequest, ctx: RouteCtx) {
  return proxyBiRequest(request, ctx.params.path);
}
