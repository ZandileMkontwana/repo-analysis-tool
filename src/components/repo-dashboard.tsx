"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  FileCode2,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  Info,
  LayoutDashboard,
  Users,
} from "lucide-react";
import type { AuthorAgg, DashboardResponse, Repo, Summary } from "@/lib/types";
import { DirectoryBrowser, FilesBrowser, MetricTable } from "./metric-table";
import { DashboardFilters } from "./dashboard-filters";
import { AuthorManager } from "./author-manager";
import { TimelineChart } from "./timeline-chart";
import {
  EmptyState,
  ErrorNotice,
  ImportProgress,
  isIndexing,
  Loading,
  number,
  percent,
  StatusBadge,
} from "./ui";
import { useResource } from "./use-resource";

const pollImport = ({ repo }: { repo: Repo }) => isIndexing(repo);

export function RepoDashboard({ id }: { id: string }) {
  const search = useSearchParams();
  const repoQuery = useResource<{ repo: Repo }>(
    `/api/repos/${encodeURIComponent(id)}/status`,
    1500,
    pollImport,
  );
  const repo = repoQuery.data?.repo;
  const scope = search.get("path") || "";
  const requestedTab = search.get("tab");
  const tab =
    requestedTab === "files" ||
    requestedTab === "directories" ||
    requestedTab === "authors"
      ? requestedTab
      : "overview";
  const filterParams = new URLSearchParams();
  for (const key of ["ref", "from", "to", "hashes", "authors"]) {
    const value = search.get(key);
    if (value) filterParams.set(key, value);
  }
  const filters = filterParams.toString();
  filterParams.set("path", scope);
  const dashboard = useResource<DashboardResponse>(
    repo?.status === "ready"
      ? `/api/repos/${encodeURIComponent(id)}/dashboard?${filterParams}`
      : null,
  );
  const data = dashboard.data;
  function href(path: string, nextTab = tab) {
    const params = new URLSearchParams(filters);
    if (path) params.set("path", path);
    if (nextTab !== "overview") params.set("tab", nextTab);
    return `/repos/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
  }
  const scopeHref = (path: string, isDir: boolean) =>
    href(path, isDir ? "directories" : "overview");
  const parent = scope.includes("/")
    ? scope.slice(0, scope.lastIndexOf("/"))
    : "";
  const browsingScope = data?.scopeIsDir === false ? parent : scope;
  const parts = scope.split("/").filter(Boolean);
  const filtered = ["from", "to", "hashes", "authors"].some((key) =>
    search.has(key),
  );

  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={16} /> All repositories
      </Link>
      {repoQuery.error && (
        <ErrorNotice message={repoQuery.error} retry={repoQuery.reload} />
      )}
      {!repo && !repoQuery.error && <Loading />}
      {repo && (
        <>
          <header className="dashboard-heading">
            <div className="dashboard-title">
              <span className="repo-icon large">
                <GitBranch size={27} />
              </span>
              <div>
                <span className="eyebrow">REPOSITORY ANALYSIS</span>
                <h1>{repo.name}</h1>
              </div>
            </div>
            <StatusBadge repo={repo} />
          </header>
          <p className="dashboard-source">{repo.source}</p>
          {isIndexing(repo) && (
            <section className="panel pending-panel">
              <h2>Building your repository’s story</h2>
              <p className="muted">
                Git history is being indexed. This view will open automatically
                when the import is complete.
              </p>
              <ImportProgress repo={repo} />
            </section>
          )}
          {repo.status === "error" && (
            <section className="panel pending-panel">
              <h2>We couldn’t import this repository</h2>
              <ErrorNotice message={repo.error || "Import failed."} />
              <p className="muted">
                Check that the URL is accessible, or that your ZIP includes a
                complete .git directory.
              </p>
              <Link className="button" href="/">
                Return to repositories
              </Link>
            </section>
          )}
          {repo.status === "ready" && (
            <>
              <div className="context-strip">
                <span>
                  <GitBranch size={15} />
                  <strong>
                    {search.get("ref") || repo.defaultBranch || "HEAD"}
                  </strong>
                  <code>
                    {!search.get("ref") && repo.headHash?.slice(0, 8)}
                  </code>
                </span>
                <span>
                  <GitCommitHorizontal size={16} />
                  {filtered
                    ? "Filtered commit set"
                    : "All history reachable from reference"}
                </span>
                <span className="muted">Non-merge commits · Text files</span>
              </div>
              <DashboardFilters
                key={search.toString()}
                repo={repo}
                repoId={id}
              />
              <nav className="tabs" aria-label="Repository views">
                <Link
                  href={href(scope, "overview")}
                  aria-current={tab === "overview" ? "page" : undefined}
                  scroll={false}
                >
                  <LayoutDashboard size={16} /> Overview
                </Link>
                <Link
                  href={href(browsingScope, "files")}
                  aria-current={tab === "files" ? "page" : undefined}
                  scroll={false}
                >
                  <FileCode2 size={16} /> Files
                </Link>
                <Link
                  href={href(browsingScope, "directories")}
                  aria-current={tab === "directories" ? "page" : undefined}
                  scroll={false}
                >
                  <FolderTree size={16} /> Directories
                </Link>
                <Link
                  href={href(scope, "authors")}
                  aria-current={tab === "authors" ? "page" : undefined}
                  scroll={false}
                >
                  <Users size={16} /> Authors
                </Link>
              </nav>
              <div className="scope-heading">
                <nav className="breadcrumbs" aria-label="Scope breadcrumb">
                  <Link
                    href={href("")}
                    scroll={false}
                    aria-current={!scope ? "page" : undefined}
                  >
                    Repository root
                  </Link>
                  {parts.map((part, index) => (
                    <span key={index}>
                      <ChevronRight size={13} />
                      {index === parts.length - 1 ? (
                        <span aria-current="page">{part}</span>
                      ) : (
                        <Link
                          href={href(parts.slice(0, index + 1).join("/"))}
                          scroll={false}
                        >
                          {part}
                        </Link>
                      )}
                    </span>
                  ))}
                </nav>
                {scope && (
                  <Link className="text-link" href={href("")} scroll={false}>
                    Reset scope <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
              {dashboard.error && (
                <ErrorNotice
                  message={dashboard.error}
                  retry={dashboard.reload}
                />
              )}
              {!data && !dashboard.error && (
                <Loading label="Calculating scope metrics…" />
              )}
              {data && (
                <>
                  <div className="section-heading scope-title">
                    <div>
                      <span className="eyebrow">
                        {scope
                          ? data.scopeIsDir
                            ? "DIRECTORY METRICS"
                            : "FILE METRICS"
                          : "REPOSITORY METRICS"}
                      </span>
                      <h2>{scope || "The big picture"}</h2>
                      <p className="muted">
                        {data.scopeIsDir
                          ? "Cumulative changes across this scope and all its descendants."
                          : "Cumulative changes attributed to this historical file path."}
                      </p>
                    </div>
                    <span className="scope-label">
                      {number(data.summary.authors)} author identities in H
                    </span>
                  </div>
                  <MetricCards summary={data.summary} />
                  {data.summary.commitSetSize === 0 && (
                    <div className="notice">
                      No non-merge commits match this reference and commit set.
                      All rates are zero.
                    </div>
                  )}
                  {tab === "files" && (
                    <FilesBrowser
                      key={`${id}|${filters}|${browsingScope}`}
                      repoId={id}
                      filters={filters}
                      scope={browsingScope}
                      href={scopeHref}
                    />
                  )}
                  {tab === "directories" && (
                    <DirectoryBrowser
                      key={`${id}|${filters}|${scope}`}
                      href={scopeHref}
                    >
                      {data.children}
                    </DirectoryBrowser>
                  )}
                  {tab === "authors" && (
                    <AuthorManager
                      key={`${id}|${filters}`}
                      repoId={id}
                      filters={filters}
                      onChanged={dashboard.reload}
                    />
                  )}
                  {tab === "overview" && (
                    <>
                      <TimelineChart points={data.timeline} />
                      {data.scopeIsDir ? (
                        <section className="panel">
                          <div className="panel-heading">
                            <div>
                              <h2>Where the code changes</h2>
                              <p className="muted">
                                Immediate children with the most churn · Click a
                                path to explore.
                              </p>
                            </div>
                            <Link
                              className="text-link"
                              href={href(scope, "directories")}
                              scroll={false}
                            >
                              Explore all paths <ArrowRight size={15} />
                            </Link>
                          </div>
                          <MetricTable
                            rows={[...data.children]
                              .sort((a, b) => b.churn - a.churn)
                              .slice(0, 8)}
                            href={scopeHref}
                            sort="churn"
                          />
                          <div className="panel-footnote">
                            Showing up to 8 of {number(data.children.length)}{" "}
                            historical files and directories.
                          </div>
                        </section>
                      ) : (
                        <div className="file-note">
                          <FileCode2 size={20} />
                          <span>
                            Viewing <strong>{scope}</strong>. Metrics track this
                            path across history, not its current line count.
                          </span>
                          <Link
                            href={href(parent, "directories")}
                            className="text-link"
                            scroll={false}
                          >
                            Containing directory <ArrowRight size={14} />
                          </Link>
                        </div>
                      )}
                      <OwnershipTable authors={data.topAuthors} />
                    </>
                  )}
                  <details className="metric-guide">
                    <summary>
                      <Info size={16} /> How to read these metrics
                    </summary>
                    <div>
                      <p>
                        <strong>H</strong> is the set of non-merge commits
                        reachable from the reference. Empty and binary-only
                        commits still count in H. Dates use the committer
                        timestamp.
                      </p>
                      <p>
                        <strong>Growth = added − removed.</strong> Churn = added
                        + removed. Modifications count distinct commits with
                        nonzero churn on the file or subtree; directory
                        modification counts are not the sum of their children.
                      </p>
                      <p>
                        <strong>Frequency = modifications / |H|.</strong> Churn
                        per commit = churn / |H|. Ownership = author churn /
                        scope churn. A zero denominator produces zero.
                      </p>
                      <p>
                        Binary files are not measured. Pure renames add no
                        churn; edits during a rename are attributed to the new
                        path. Deleted and renamed historical paths may still
                        appear.
                      </p>
                    </div>
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function MetricCards({ summary: s }: { summary: Summary }) {
  const cards = [
    {
      label: "Commit set",
      value: number(s.commitSetSize),
      symbol: "|H|",
      detail: "Non-merge commits",
      color: "",
    },
    {
      label: "Lines added",
      value: number(s.added),
      symbol: "l+",
      detail: "Cumulative additions",
      color: "positive",
    },
    {
      label: "Lines removed",
      value: number(s.removed),
      symbol: "l−",
      detail: "Cumulative deletions",
      color: "negative",
    },
    {
      label: "Net growth",
      value: `${s.growth > 0 ? "+" : ""}${number(s.growth)}`,
      symbol: "δ",
      detail: "Added − removed",
      color: "",
    },
    {
      label: "Total churn",
      value: number(s.churn),
      symbol: "λ",
      detail: "Added + removed",
      color: "accent",
    },
    {
      label: "Modifications",
      value: number(s.modifications),
      symbol: "n",
      detail: "Commits changing this scope",
      color: "",
    },
    {
      label: "Modification frequency",
      value: percent(s.frequency),
      symbol: "η",
      detail: "Modifications / |H|",
      color: "",
    },
    {
      label: "Churn per commit",
      value: number(s.churnRate),
      symbol: "ρ",
      detail: "Changed lines / |H|",
      color: "",
    },
  ];
  return (
    <div className="metric-grid">
      {cards.map((card) => (
        <article
          className={`metric-card ${card.color === "accent" ? "highlight-card" : ""}`}
          key={card.label}
        >
          <div>
            <h3>{card.label}</h3>
            <span className="metric-symbol" aria-hidden="true">
              {card.symbol}
            </span>
          </div>
          <strong className={card.color}>{card.value}</strong>
          <p>{card.detail}</p>
        </article>
      ))}
    </div>
  );
}

function OwnershipTable({ authors }: { authors: AuthorAgg[] }) {
  return (
    <section className="panel ownership-panel">
      <div className="panel-heading">
        <div>
          <h2>People behind the changes</h2>
          <p className="muted">
            Top {authors.length} contributors by churn in this scope · Mailmap
            and saved identity groups applied.
          </p>
        </div>
        <span className="eyebrow">AUTHOR OWNERSHIP</span>
      </div>
      {!authors.length ? (
        <EmptyState title="No contributor changes">
          <p>There is no measured churn for this scope.</p>
        </EmptyState>
      ) : (
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Author ownership metrics"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Contributor</th>
                <th scope="col">Modifications</th>
                <th scope="col">Churn</th>
                <th scope="col">Ownership</th>
              </tr>
            </thead>
            <tbody>
              {authors.map((author, index) => (
                <tr key={author.key}>
                  <td>
                    <div className="author-cell">
                      <span className={`avatar avatar-${index % 4}`}>
                        {author.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{author.name}</strong>
                        <span>
                          {author.isGroup
                            ? `${author.memberIds.length} merged identities`
                            : author.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>{number(author.modifications)}</td>
                  <td>{number(author.churn)}</td>
                  <td>{percent(author.ownership)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel-footnote">
        Ownership is relative to total scope churn. Only the top 14 contributors
        are shown, so displayed percentages may not sum to 100%.
      </div>
    </section>
  );
}
