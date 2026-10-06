import { NextResponse } from "next/server";
import { ApiError, errorMessage } from "./errors";
import { getRepoRow, type RepoDbRow } from "./db";
import type { MetricsFilters } from "./types";

export const MAX_MANUAL_HASHES = 3000;

export function parseRepoId(raw: string): number {
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0) throw new ApiError(400, "Invalid repository id.");
  return id;
}

export function requireRepo(raw: string): RepoDbRow {
  const row = getRepoRow(parseRepoId(raw));
  if (!row) throw new ApiError(404, "Repository not found.");
  return row;
}

export function requireReadyRepo(raw: string): RepoDbRow {
  const row = requireRepo(raw);
  if (row.status !== "ready") {
    throw new ApiError(
      409,
      row.status === "error"
        ? `Repository ingestion failed: ${row.error ?? "unknown error"}`
        : "Repository is still being ingested — wait for it to finish.",
    );
  }
  return row;
}

export function parseFilters(sp: URLSearchParams): MetricsFilters {
  const filters: MetricsFilters = {};
  const ref = sp.get("ref")?.trim();
  if (ref) filters.ref = ref;
  const from = sp.get("from");
  if (from) {
    const n = parseInt(from, 10);
    if (Number.isFinite(n)) filters.from = n;
  }
  const to = sp.get("to");
  if (to) {
    const n = parseInt(to, 10);
    if (Number.isFinite(n)) filters.to = n;
  }
  const hashes = sp.get("hashes");
  if (hashes) {
    const list = hashes.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > MAX_MANUAL_HASHES) {
      throw new ApiError(
        400,
        `Manual commit selection is limited to ${MAX_MANUAL_HASHES} commits.`,
      );
    }
    if (list.length > 0) filters.hashes = list;
  }
  const authors = sp.get("authors");
  if (authors) {
    const list = authors
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    if (list.length > 0) filters.authorIds = list;
  }
  const scopePath = sp.get("path");
  filters.path = scopePath ?? "";
  return filters;
}

/** Removes the manual commit list from the filters (used while browsing to edit a selection). */
export function stripManualSelection(filters: MetricsFilters): MetricsFilters {
  const copy = { ...filters };
  delete copy.hashes;
  return copy;
}

export function handleError(e: unknown): NextResponse {
  const status = e instanceof ApiError ? e.status : 500;
  if (status >= 500) console.error("API error:", e);
  return NextResponse.json({ error: errorMessage(e) }, { status });
}
