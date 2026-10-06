import { NextRequest, NextResponse } from "next/server";
import { requireReadyRepo, parseFilters, handleError } from "@/lib/api";
import { getDashboard } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireReadyRepo(id);
    const filters = parseFilters(req.nextUrl.searchParams);
    const dashboard = getDashboard(row.id, filters);
    return NextResponse.json(dashboard);
  } catch (e) {
    return handleError(e);
  }
}
