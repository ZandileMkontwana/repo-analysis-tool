import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  GitBranch,
  LoaderCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Repo } from "@/lib/types";

export const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
export const percent = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
export const isIndexing = (repo: Repo) =>
  repo.status !== "ready" && repo.status !== "error";

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <header className="app-header">
        <Link
          className="brand"
          href="/"
          aria-label="RAT — repository workspace"
        >
          <span className="brand-mark">
            <GitBranch size={23} />
          </span>
          <span>
            RAT<span className="brand-subtitle">REPO ANALYSIS TOOL</span>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link className="workspace-link" href="/">
            Your repositories <ArrowUpRight size={15} />
          </Link>
        </nav>
        <span className="local-badge">
          <span className="status-dot" /> Local workspace
        </span>
      </header>
      <main id="main-content" className="main-content">
        {children}
      </main>
      <footer className="app-footer">
        <span>RAT / Understand the story behind your code.</span>
        <span>Git-powered · Locally stored</span>
      </footer>
    </div>
  );
}

export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && (
        <button className="button small" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({
  label = "Loading repository data…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <GitBranch size={30} />
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}

export function StatusBadge({ repo }: { repo: Repo }) {
  return (
    <span
      className={`badge ${repo.status === "ready" ? "success" : repo.status === "error" ? "danger" : "working"}`}
    >
      {isIndexing(repo) ? (
        <LoaderCircle size={12} className="spin" />
      ) : (
        <span className="status-dot" />
      )}
      {repo.status === "ready"
        ? "Ready to explore"
        : repo.status === "error"
          ? "Import failed"
          : repo.progress.phase || "Queued"}
    </span>
  );
}

export function ImportProgress({ repo }: { repo: Repo }) {
  const p = repo.progress;
  const value =
    p.total && p.done !== undefined ? (p.done / p.total) * 100 : p.pct;
  const pct =
    value === undefined
      ? undefined
      : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="import-progress" role="status">
      <div className="progress-caption">
        <span>{p.phase || "Preparing repository"}</span>
        <span>{pct === undefined ? "In progress" : `${pct}%`}</span>
      </div>
      <progress
        aria-label={p.phase || "Repository import"}
        max={100}
        value={pct}
      />
      <p className="muted">
        {p.total
          ? `${number(p.done || 0)} of ${number(p.total)} commits indexed`
          : "Keep the local server running. You can browse other repositories while this finishes."}
      </p>
    </div>
  );
}
