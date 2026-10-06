import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db, repoToJson, REPOS_DIR } from "@/lib/db";
import { requireRepo, handleError } from "@/lib/api";
import { purgeRepoCache } from "@/lib/metrics";
import { ApiError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireRepo(id);
    if (row.status === "cloning" || row.status === "extracting" || row.status === "parsing") {
      throw new ApiError(409, "Cannot delete a repository while it is being ingested.");
    }
    db.prepare("DELETE FROM repos WHERE id = ?").run(row.id);
    purgeRepoCache(row.id);
    const repoDir = path.join(REPOS_DIR, `repo-${row.id}`);
    if (repoDir.startsWith(REPOS_DIR) && fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
