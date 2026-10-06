"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Database,
  FileArchive,
  GitBranch,
  GitCommitHorizontal,
  Plus,
  Search,
  Users,
} from "lucide-react";
import type { Repo } from "@/lib/types";
import { ImportRepo } from "./import-repo";
import {
  EmptyState,
  ErrorNotice,
  ImportProgress,
  isIndexing,
  Loading,
  number,
  StatusBadge,
} from "./ui";
import { useResource } from "./use-resource";

export function RepoLibrary() {
  const { data, error, reload } = useResource<{ repos: Repo[] }>(
    "/api/repos",
    3000,
  );
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [createdId, setCreatedId] = useState<number | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const repos = data?.repos || [];
  const visible = repos.filter((r) =>
    `${r.name} ${r.source}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const ready = repos.filter((r) => r.status === "ready");
  function closeForm() {
    setAdding(false);
    addButton.current?.focus();
  }

  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span className="accent-line" /> YOUR CODE, IN PERSPECTIVE
          </div>
          <h1>
            Every repository
            <br />
            has a <span>story.</span>
          </h1>
          <p>
            Understand what changed, where it happened, and who made it happen.
            Start with your Git history.
          </p>
        </div>
        <div className="hero-aside">
          <span className="hero-glyph" aria-hidden="true">
            <GitBranch size={80} strokeWidth={1} />
          </span>
          <button
            className="button primary"
            ref={addButton}
            disabled={adding}
            onClick={() => setAdding(true)}
          >
            <Plus size={18} /> Add repository
          </button>
          <span className="muted">Clone a URL or upload a ZIP</span>
        </div>
      </section>
      {adding && (
        <ImportRepo
          onClose={closeForm}
          onCreated={(id) => {
            setCreatedId(id);
            setQuery("");
            closeForm();
            reload();
          }}
        />
      )}
      {createdId !== null && (
        <div className="notice" role="status">
          Repository submitted for indexing.{" "}
          <Link href={`/repos/${createdId}`}>
            Follow import progress <ArrowRight size={14} />
          </Link>
        </div>
      )}
      <div className="workspace-stats">
        <div>
          <Database size={18} />
          <span>
            <strong>{data ? number(repos.length) : "—"}</strong> repositories
          </span>
        </div>
        <div>
          <GitBranch size={18} />
          <span>
            <strong>{data ? number(ready.length) : "—"}</strong> ready to
            explore
          </span>
        </div>
        <div>
          <GitCommitHorizontal size={18} />
          <span>
            <strong>
              {data
                ? number(
                    ready.reduce((sum, r) => sum + (r.stats.commits || 0), 0),
                  )
                : "—"}
            </strong>{" "}
            indexed commits
          </span>
        </div>
      </div>
      <section aria-labelledby="repositories-title">
        <div className="section-heading">
          <div>
            <h2 id="repositories-title">
              Your repositories <span className="count">{repos.length}</span>
            </h2>
            <p className="muted">A workspace for your code’s history.</p>
          </div>
          <label className="search-box">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search repositories"
              placeholder="Find a repository…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {error && <ErrorNotice message={error} retry={reload} />}
        {!data && !error && <Loading label="Loading your workspace…" />}
        {data && !repos.length && (
          <div className="panel">
            <EmptyState title="Your next insight starts here">
              <p>
                Add your first repository to explore its commit history and line
                metrics.
              </p>
              <button
                className="button primary"
                disabled={adding}
                onClick={() => setAdding(true)}
              >
                <Plus size={16} /> Add your first repository
              </button>
            </EmptyState>
          </div>
        )}
        {repos.length > 0 && !visible.length && (
          <EmptyState title="No repositories found">
            <p>Try a different name or clear your search.</p>
            <button className="button small" onClick={() => setQuery("")}>
              Clear search
            </button>
          </EmptyState>
        )}
        <div className="repo-grid">
          {visible.map((repo) => (
            <article className="repo-card panel" key={repo.id}>
              <div className="repo-card-top">
                <span className="repo-icon">
                  {repo.sourceKind === "zip" ? (
                    <FileArchive size={23} />
                  ) : (
                    <GitBranch size={23} />
                  )}
                </span>
                <StatusBadge repo={repo} />
              </div>
              <h3>
                <Link href={`/repos/${repo.id}`}>{repo.name}</Link>
              </h3>
              <p className="repo-source" title={repo.source}>
                {repo.source}
              </p>
              {isIndexing(repo) ? (
                <ImportProgress repo={repo} />
              ) : repo.status === "error" ? (
                <p className="repo-error">
                  {repo.error || "The repository could not be indexed."}
                </p>
              ) : (
                <div className="repo-facts">
                  <span>
                    <GitCommitHorizontal size={15} />
                    {number(repo.stats.commits || 0)} commits
                  </span>
                  <span>
                    <Users size={15} />
                    {number(repo.stats.authors || 0)} identities
                  </span>
                </div>
              )}
              <div className="repo-card-bottom">
                <span className="muted">
                  <GitBranch size={13} />{" "}
                  {repo.defaultBranch ||
                    (repo.sourceKind === "zip"
                      ? "ZIP archive"
                      : "Git repository")}
                </span>
                <Link className="text-link" href={`/repos/${repo.id}`}>
                  {repo.status === "ready"
                    ? "Explore repository"
                    : "View import"}
                  <ArrowRight size={15} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <aside className="method-note">
        <Database size={19} />
        <div>
          <strong>Your history, analyzed locally.</strong>
          <p>
            Repository snapshots and metrics stay on this server. Import once,
            then explore cached results without running Git for every view.
          </p>
        </div>
      </aside>
    </>
  );
}
