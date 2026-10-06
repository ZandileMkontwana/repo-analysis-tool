import { NextRequest, NextResponse } from "next/server";
import { repoToJson } from "@/lib/db";
import { requireRepo, handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight polling endpoint for ingestion progress. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireRepo(id);
    return NextResponse.json({ repo: repoToJson(row) });
  } catch (e) {
    return handleError(e);
  }
}
