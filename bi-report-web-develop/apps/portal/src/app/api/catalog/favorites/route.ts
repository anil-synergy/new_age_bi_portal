import { NextRequest } from "next/server";
import { handleBiFavorite } from "@/lib/server/bi-favorites";

export async function PUT(request: NextRequest) {
  return handleBiFavorite(request);
}
