import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireReadyRepo, parseFilters, handleError } from "@/lib/api";
import {
  getAuthorGroupsList,
  getAuthorList,
  purgeRepoCache,
} from "@/lib/metrics";
import { ApiError } from "@/lib/errors";

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
    return NextResponse.json({
      authors: getAuthorList(row.id, filters),
      groups: getAuthorGroupsList(row.id),
    });
  } catch (e) {
    return handleError(e);
  }
}

/** Merge several author identities into one author group. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireReadyRepo(id);
    const body = (await req.json().catch(() => null)) as {
      authorIds?: number[];
      label?: string;
    } | null;
    const authorIds = (body?.authorIds ?? []).filter((n) => Number.isFinite(n));
    if (authorIds.length < 2) {
      throw new ApiError(400, "Select at least two authors to merge.");
    }
    const placeholders = authorIds.map(() => "?").join(",");
    const valid = db
      .prepare(
        `SELECT COUNT(*) AS c FROM authors WHERE repo_id = ? AND id IN (${placeholders})`,
      )
      .get(row.id, ...authorIds) as { c: number };
    if (valid.c !== new Set(authorIds).size) {
      throw new ApiError(400, "Some selected authors do not belong to this repository.");
    }

    let label = (body?.label ?? "").trim();
    if (!label) {
      const first = db
        .prepare("SELECT name, email FROM authors WHERE id = ?")
        .get(authorIds[0]) as { name: string; email: string } | undefined;
      const suffix = authorIds.length > 1 ? ` +${authorIds.length - 1}` : "";
      label = first ? `${first.name} <${first.email}>${suffix}` : `Merged author${suffix}`;
    }

    const tx = db.transaction(() => {
      const groupInfo = db
        .prepare("INSERT INTO author_groups (repo_id, label) VALUES (?, ?)")
        .run(row.id, label);
      const groupId = Number(groupInfo.lastInsertRowid);
      // Move authors out of any other group they were part of.
      db.prepare(
        `DELETE FROM author_group_members WHERE author_id IN (${placeholders})`,
      ).run(...authorIds);
      const insertMember = db.prepare(
        "INSERT OR IGNORE INTO author_group_members (group_id, author_id) VALUES (?, ?)",
      );
      for (const authorId of authorIds) insertMember.run(groupId, authorId);
      // Clean up groups that are now empty.
      db.prepare(
        `DELETE FROM author_groups WHERE repo_id = ? AND NOT EXISTS (
           SELECT 1 FROM author_group_members m WHERE m.group_id = author_groups.id
         )`,
      ).run(row.id);
      return groupId;
    });
    const groupId = tx();
    purgeRepoCache(row.id);
    return NextResponse.json({ groupId, label }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

/** Unmerge an author group. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = requireReadyRepo(id);
    const groupId = parseInt(req.nextUrl.searchParams.get("groupId") ?? "", 10);
    if (!Number.isFinite(groupId)) throw new ApiError(400, "Provide a groupId to unmerge.");
    const info = db
      .prepare("DELETE FROM author_groups WHERE id = ? AND repo_id = ?")
      .run(groupId, row.id);
    if (info.changes === 0) throw new ApiError(404, "Author group not found.");
    purgeRepoCache(row.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
