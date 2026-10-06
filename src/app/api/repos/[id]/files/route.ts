import { NextRequest, NextResponse } from "next/server";
import { requireReadyRepo, parseFilters, handleError } from "@/lib/api";
import { listFiles, type FileSortKey } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: FileSortKey[] = ["path", "added", "removed", "growth", "churn", "modifications"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireReadyRepo(id);
    const sp = req.nextUrl.searchParams;
    const filters = parseFilters(sp);
    const sortRaw = sp.get("sort") ?? "churn";
    const sort = (SORTS.includes(sortRaw as FileSortKey) ? sortRaw : "churn") as FileSortKey;
    const dir = sp.get("dir") === "asc" ? "asc" : "desc";
    const result = listFiles(row.id, filters, {
      scope: sp.get("scope") ?? "",
      q: sp.get("q") ?? undefined,
      sort,
      dir,
      page: Number(sp.get("page") ?? 1) || 1,
      pageSize: Number(sp.get("pageSize") ?? 50) || 50,
    });
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
