import { NextRequest, NextResponse } from "next/server";
import { requireReadyRepo, parseFilters, stripManualSelection, handleError } from "@/lib/api";
import { listCommits } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireReadyRepo(id);
    const sp = req.nextUrl.searchParams;
    let filters = parseFilters(sp);
    if (sp.get("stripHashes") === "1") filters = stripManualSelection(filters);
    const authorIdsRaw = sp.get("authorIds");
    const authorIds = authorIdsRaw
      ? authorIdsRaw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
      : undefined;
    const result = listCommits(row.id, filters, {
      q: sp.get("q") ?? undefined,
      page: Number(sp.get("page") ?? 1) || 1,
      pageSize: Number(sp.get("pageSize") ?? 50) || 50,
      authorIds,
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
