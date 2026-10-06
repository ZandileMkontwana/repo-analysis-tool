import { NextRequest, NextResponse } from "next/server";
import { db, repoToJson, type RepoDbRow } from "@/lib/db";
import { createRepoFromUrl } from "@/lib/ingest";
import { ApiError } from "@/lib/errors";
import { handleError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = db
      .prepare("SELECT * FROM repos ORDER BY created_at DESC, id DESC")
      .all() as RepoDbRow[];
    return NextResponse.json({ repos: rows.map(repoToJson) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { url?: string } | null;
    const url = body?.url?.trim();
    if (!url) throw new ApiError(400, "Provide a repository URL.");
    const id = createRepoFromUrl(url);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
