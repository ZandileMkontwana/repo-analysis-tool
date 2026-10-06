"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Folder,
  Search,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import type { DirChild, ObjectMetricsRates } from "@/lib/types";
import { EmptyState, ErrorNotice, Loading, number, percent } from "./ui";
import { useResource } from "./use-resource";

export type SortKey =
  | "path"
  | "added"
  | "removed"
  | "growth"
  | "churn"
  | "modifications"
  | "frequency"
  | "churnRate";
type MetricRow = ObjectMetricsRates & {
  path: string;
  name?: string;
  isDir?: boolean;
};
export type ScopeLink = (path: string, isDir: boolean) => string;
const columns: { key: SortKey; label: string; title: string }[] = [
  { key: "path", label: "Path", title: "Historical file path or directory" },
  { key: "added", label: "Added", title: "Lines added across the commit set" },
  {
    key: "removed",
    label: "Removed",
    title: "Lines removed across the commit set",
  },
  { key: "growth", label: "Growth", title: "Net growth: added − removed" },
  {
    key: "churn",
    label: "Churn",
    title: "Total changed lines: added + removed",
  },
  {
    key: "modifications",
    label: "Modifications",
    title: "Distinct commits with nonzero churn on this object",
  },
  {
    key: "frequency",
    label: "Frequency",
    title: "Modifications / number of commits in H",
  },
  {
    key: "churnRate",
    label: "Churn / commit",
    title: "Churn / number of commits in H",
  },
];

export function MetricTable({
  rows,
  href,
  sort,
  direction = "desc",
  onSort,
}: {
  rows: MetricRow[];
  href: ScopeLink;
  sort?: SortKey;
  direction?: "asc" | "desc";
  onSort?: (key: SortKey) => void;
}) {
  if (!rows.length)
    return (
      <EmptyState title="No paths to display">
        <p>No measurable text-file changes were found for this view.</p>
      </EmptyState>
    );
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Path metrics; scroll horizontally to see all columns"
    >
      <table className="metric-table">
        <caption className="sr-only">
          Line metrics for historical files and directories. Select a path to
          drill down.
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort === column.key
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                title={column.title}
              >
                {onSort ? (
                  <button onClick={() => onSort(column.key)}>
                    {column.label}
                    {sort === column.key &&
                      (direction === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      ))}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.isDir ? "d" : "f"}:${row.path}`}>
              <td>
                <Link
                  className="path-link"
                  href={href(row.path, Boolean(row.isDir))}
                  scroll={false}
                  title={row.path}
                >
                  {row.isDir ? (
                    <Folder size={17} className="folder-icon" />
                  ) : (
                    <FileCode2 size={16} />
                  )}
                  <span>
                    {row.name || row.path}
                    {row.isDir ? "/" : ""}
                  </span>
                </Link>
              </td>
              <td className="positive">{number(row.added)}</td>
              <td className="negative">{number(row.removed)}</td>
              <td>
                {row.growth > 0 ? "+" : ""}
                {number(row.growth)}
              </td>
              <td className="churn-value">{number(row.churn)}</td>
              <td>{number(row.modifications)}</td>
              <td>{percent(row.frequency)}</td>
              <td>{number(row.churnRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DirectoryBrowser({
  children: entries,
  href,
}: {
  children: DirChild[];
  href: ScopeLink;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("path");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const rows = entries
    .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      const order =
        sort === "path" ? a.path.localeCompare(b.path) : a[sort] - b[sort];
      return (
        (direction === "asc" ? order : -order) || a.path.localeCompare(b.path)
      );
    });
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Directory explorer</h2>
          <p className="muted">
            Immediate children · Select a folder to go deeper.
          </p>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search directory children"
            placeholder="Find a file or folder…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <MetricTable
        rows={rows.slice((page - 1) * 25, page * 25)}
        href={href}
        sort={sort}
        direction={direction}
        onSort={(key) => {
          setSort(key);
          setDirection(sort === key && direction === "asc" ? "desc" : "asc");
          setPage(1);
        }}
      />
      <Pagination
        page={page}
        pageSize={25}
        total={rows.length}
        onPage={setPage}
      />
    </section>
  );
}

interface FilePage {
  rows: (ObjectMetricsRates & { path: string })[];
  total: number;
  page: number;
  pageSize: number;
  commitSetSize: number;
}

export function FilesBrowser({
  repoId,
  filters,
  scope,
  href,
}: {
  repoId: string;
  filters: string;
  scope: string;
  href: ScopeLink;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("churn");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams(filters);
  params.set("scope", scope);
  params.set("q", query);
  // All rows share |H|, so sorting the numerator also sorts each rate.
  params.set(
    "sort",
    sort === "frequency"
      ? "modifications"
      : sort === "churnRate"
        ? "churn"
        : sort,
  );
  params.set("dir", direction);
  params.set("page", String(page));
  params.set("pageSize", "25");
  const { data, error, reload } = useResource<FilePage>(
    `/api/repos/${repoId}/files?${params}`,
  );
  function search(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
    setPage(1);
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            All files{" "}
            {data && <span className="count">{number(data.total)}</span>}
          </h2>
          <p className="muted">
            Historical paths{" "}
            {scope ? `under ${scope}/` : "across the repository"} · Sorted by{" "}
            {columns.find((c) => c.key === sort)?.label.toLowerCase()}
          </p>
        </div>
        <form className="search-form" onSubmit={search}>
          <label className="search-box">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search files"
              placeholder="Search file paths…"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (!e.target.value) {
                  setQuery("");
                  setPage(1);
                }
              }}
            />
          </label>
          <button className="button small" type="submit">
            Search
          </button>
        </form>
      </div>
      {error && <ErrorNotice message={error} retry={reload} />}
      {!data && !error && <Loading label="Loading file metrics…" />}
      {data && (
        <>
          <MetricTable
            rows={data.rows}
            href={href}
            sort={sort}
            direction={direction}
            onSort={(key) => {
              setDirection(
                key === sort && direction === "desc" ? "asc" : "desc",
              );
              setSort(key);
              setPage(1);
            }}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={setPage}
          />
        </>
      )}
    </section>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {total
          ? `${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))} of ${number(total)}`
          : "0 results"}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          Page {number(page)} of {number(pages)}
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
