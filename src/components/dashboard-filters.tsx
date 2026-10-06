"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  Filter,
  GitBranch,
  RotateCcw,
  Users,
} from "lucide-react";
import type { AuthorGroupRow, AuthorRow, CommitRow, Repo } from "@/lib/types";
import { ErrorNotice } from "./ui";
import { useResource } from "./use-resource";

type AuthorPayload = { authors: AuthorRow[]; groups: AuthorGroupRow[] };
type CommitPayload = {
  rows: CommitRow[];
  total: number;
  page: number;
  pageSize: number;
  commitSetSize: number;
};
type Mode = "all" | "time" | "manual";

function dateValue(value: string | null) {
  if (!value) return "";
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().slice(0, 10)
    : "";
}

export function DashboardFilters({
  repo,
  repoId,
}: {
  repo: Repo;
  repoId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const initialMode: Mode = search.has("hashes")
    ? "manual"
    : search.has("from") || search.has("to")
      ? "time"
      : "all";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [refName, setRefName] = useState(search.get("ref") || "HEAD");
  const [from, setFrom] = useState(dateValue(search.get("from")));
  const [to, setTo] = useState(dateValue(search.get("to")));
  const [hashes, setHashes] = useState(
    (search.get("hashes") || "").split(",").join("\n"),
  );
  const [authorValue, setAuthorValue] = useState(search.get("authors") || "");
  const [commitSearch, setCommitSearch] = useState("");
  const authorQuery = useResource<AuthorPayload>(
    `/api/repos/${encodeURIComponent(repoId)}/authors?ref=${encodeURIComponent(refName || "HEAD")}`,
  );
  const commitQuery = useResource<CommitPayload>(
    mode === "manual"
      ? `/api/repos/${encodeURIComponent(repoId)}/commits?stripHashes=1&ref=${encodeURIComponent(refName || "HEAD")}&q=${encodeURIComponent(commitSearch)}&pageSize=50`
      : null,
  );
  const groups = authorQuery.data?.groups || [];
  const authors = authorQuery.data?.authors || [];
  const grouped = new Set(groups.flatMap((g) => g.members));
  const selectedHashes = new Set(
    hashes
      .split(/[\s,]+/)
      .map((hash) => hash.trim())
      .filter(Boolean),
  );
  const activeCount = [
    search.has("ref"),
    search.has("from") || search.has("to") || search.has("hashes"),
    search.has("authors"),
  ].filter(Boolean).length;

  function apply(event: FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(search.toString());
    for (const key of ["ref", "from", "to", "hashes", "authors"])
      next.delete(key);
    if (refName && refName !== "HEAD") next.set("ref", refName);
    if (mode === "time") {
      if (from)
        next.set(
          "from",
          String(Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000)),
        );
      if (to)
        next.set(
          "to",
          String(Math.floor(new Date(`${to}T00:00:00Z`).getTime() / 1000)),
        );
    }
    if (mode === "manual") {
      const list = hashes
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean);
      if (list.length) next.set("hashes", list.join(","));
    }
    if (authorValue) next.set("authors", authorValue);
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  function toggleCommit(hash: string) {
    const next = new Set(selectedHashes);
    if (next.has(hash)) next.delete(hash);
    else next.add(hash);
    setHashes([...next].join("\n"));
  }

  function reset() {
    const next = new URLSearchParams();
    const path = search.get("path");
    const tab = search.get("tab");
    if (path) next.set("path", path);
    if (tab) next.set("tab", tab);
    setMode("all");
    setRefName("HEAD");
    setFrom("");
    setTo("");
    setHashes("");
    setAuthorValue("");
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  return (
    <details className="filter-panel panel" open={activeCount > 0}>
      <summary>
        <span>
          <Filter size={16} /> Filters {activeCount > 0 && <b>{activeCount}</b>}
        </span>
        <span className="muted">Reference · commit set · author</span>
      </summary>
      <form onSubmit={apply}>
        <div className="filter-grid">
          <label>
            <span>
              <GitBranch size={14} /> Reference
            </span>
            <select
              value={refName}
              onChange={(e) => setRefName(e.target.value)}
            >
              <option value="HEAD">
                HEAD · {repo.defaultBranch || "default"}
              </option>
              {repo.refs
                .filter((r) => r.name !== "HEAD")
                .map((r) => (
                  <option value={r.name} key={`${r.type}:${r.name}`}>
                    {r.type === "tag" ? "Tag" : "Branch"} · {r.name}
                  </option>
                ))}
            </select>
          </label>
          <fieldset>
            <legend>
              <CalendarDays size={14} /> Commit set H
            </legend>
            <div className="mode-options">
              <label>
                <input
                  type="radio"
                  name="commit-mode"
                  checked={mode === "all"}
                  onChange={() => setMode("all")}
                />{" "}
                All history
              </label>
              <label>
                <input
                  type="radio"
                  name="commit-mode"
                  checked={mode === "time"}
                  onChange={() => setMode("time")}
                />{" "}
                Time range
              </label>
              <label>
                <input
                  type="radio"
                  name="commit-mode"
                  checked={mode === "manual"}
                  onChange={() => setMode("manual")}
                />{" "}
                Manual commits
              </label>
            </div>
          </fieldset>
          <label>
            <span>
              <Users size={14} /> Author identity
            </span>
            <select
              value={authorValue}
              onChange={(e) => setAuthorValue(e.target.value)}
            >
              <option value="">All authors</option>
              {groups.map((g) => (
                <option key={`g:${g.id}`} value={g.members.join(",")}>
                  {g.label} · {g.members.length} identities
                </option>
              ))}
              {authors
                .filter((a) => !grouped.has(a.id))
                .map((a) => (
                  <option key={`a:${a.id}`} value={String(a.id)}>
                    {a.name} · {a.commitsInSet || 0} commits
                  </option>
                ))}
            </select>
          </label>
        </div>
        {mode === "time" && (
          <div className="range-fields">
            <label>
              <span>From (inclusive)</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              <span>Before (exclusive)</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
        )}
        {mode === "manual" && (
          <div className="manual-field">
            <div className="commit-picker-heading">
              <span>Select commits</span>
              <b>{selectedHashes.size} selected</b>
            </div>
            <input
              className="commit-search"
              type="search"
              value={commitSearch}
              onChange={(e) => setCommitSearch(e.target.value)}
              placeholder="Search by message or hash"
              aria-label="Search commits"
            />
            <div className="commit-picker" role="group" aria-label="Commits">
              {commitQuery.loading && <p className="muted">Loading commits…</p>}
              {commitQuery.error && (
                <ErrorNotice
                  message={commitQuery.error}
                  retry={commitQuery.reload}
                />
              )}
              {!commitQuery.loading &&
                !commitQuery.error &&
                commitQuery.data?.rows.length === 0 && (
                  <p className="muted">No commits match this search.</p>
                )}
              {commitQuery.data?.rows.map((commit) => (
                <label className="commit-option" key={commit.hash}>
                  <input
                    type="checkbox"
                    checked={selectedHashes.has(commit.hash)}
                    onChange={() => toggleCommit(commit.hash)}
                  />
                  <span>
                    <strong>{commit.subject || "Untitled commit"}</strong>
                    <small>
                      <code>{commit.hash.slice(0, 8)}</code> ·{" "}
                      {commit.authorName} ·{" "}
                      {new Date(commit.date * 1000).toLocaleDateString()}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            {commitQuery.data &&
              commitQuery.data.total > commitQuery.data.rows.length && (
                <small>
                  Showing the latest {commitQuery.data.rows.length} of{" "}
                  {commitQuery.data.total} matches. Search to find older
                  commits.
                </small>
              )}
            <details className="manual-hash-entry">
              <summary>Paste commit hashes instead</summary>
              <textarea
                rows={3}
                value={hashes}
                onChange={(e) => setHashes(e.target.value)}
                placeholder="One hash per line, or comma-separated"
              />
            </details>
            <small>
              Only selected non-merge commits reachable from the reference
              contribute to H.
            </small>
          </div>
        )}
        {authorQuery.error && (
          <ErrorNotice message={authorQuery.error} retry={authorQuery.reload} />
        )}
        <div className="filter-actions">
          <button className="button primary" type="submit">
            <Filter size={14} /> Apply filters
          </button>
          <button className="button" type="button" onClick={reset}>
            <RotateCcw size={14} /> Reset filters
          </button>
        </div>
      </form>
    </details>
  );
}
