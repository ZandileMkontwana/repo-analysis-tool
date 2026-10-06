// Shared types for the Repo Analysis Tool (RAT).

export type RepoStatus =
  | "pending"
  | "cloning"
  | "extracting"
  | "parsing"
  | "ready"
  | "error";

export type SourceKind = "url" | "zip";

export interface RepoRef {
  name: string;
  type: "head" | "branch" | "tag" | "other";
  hash: string;
}

export interface RepoProgress {
  phase: string;
  pct?: number;
  done?: number;
  total?: number;
  detail?: string;
}

export interface RepoStats {
  commits?: number;
  changeRows?: number;
  authors?: number;
}

export interface Repo {
  id: number;
  name: string;
  sourceKind: SourceKind;
  source: string;
  status: RepoStatus;
  progress: RepoProgress;
  error: string | null;
  headHash: string | null;
  defaultBranch: string | null;
  refs: RepoRef[];
  stats: RepoStats;
  createdAt: number;
}

/** Aggregate line metrics for a file/directory over a commit set H. */
export interface ObjectMetrics {
  added: number; // l+_H,o
  removed: number; // l-_H,o
  growth: number; // dl_H,o = added - removed
  churn: number; // lambda_H,o = added + removed
  modifications: number; // n_H,o = # commits in H with churn > 0
}

export interface ObjectMetricsRates extends ObjectMetrics {
  frequency: number; // eta = modifications / |H|
  churnRate: number; // rho = churn / |H|
}

export interface Summary extends ObjectMetricsRates {
  commitSetSize: number; // |H|
  authors: number; // distinct authors in H
}

export interface PathStat extends ObjectMetrics {
  path: string;
}

export interface DirChild extends ObjectMetricsRates {
  name: string;
  path: string;
  isDir: boolean;
}

export interface TimelinePoint {
  day: number; // unix seconds, day-aligned
  added: number;
  removed: number;
  commits: number;
}

export interface AuthorAgg extends ObjectMetricsRates {
  /** Solo author id; null for merged-group rows. */
  authorId: number | null;
  /** Stable row key: `g:<groupId>` or `a:<authorId>`. */
  key: string;
  isGroup: boolean;
  /** All author ids this row aggregates (group members, or the single author). */
  memberIds: number[];
  name: string;
  email: string;
  commits: number; // commits by author in H
  ownership: number; // omega = lambda_H,o,a / lambda_H,o (0 when lambda = 0)
  groupId: number | null;
  groupLabel: string | null;
}

export interface AuthorRow {
  id: number;
  name: string;
  email: string;
  commitsInSet?: number;
  groupId: number | null;
  groupLabel: string | null;
}

export interface AuthorGroupRow {
  id: number;
  label: string;
  members: number[];
}

export interface DashboardResponse {
  summary: Summary;
  scope: string; // path prefix of the current scope ("" = repo root)
  scopeIsDir: boolean;
  children: DirChild[]; // immediate children of scope (files + directories)
  timeline: TimelinePoint[];
  topAuthors: AuthorAgg[]; // per-author metrics over H within scope
}

export interface CommitRow {
  id: number;
  hash: string;
  date: number;
  subject: string;
  authorId: number;
  authorName: string;
  authorEmail: string;
  added: number;
  removed: number;
  files: number;
}

/** Filter state shared by the dashboard endpoints. */
export interface MetricsFilters {
  ref?: string; // reference commit (name or hash); defaults to HEAD
  from?: number; // inclusive unix seconds (committer date)
  to?: number; // exclusive unix seconds
  hashes?: string[]; // manual commit set (overrides from/to)
  authorIds?: number[]; // restrict commit set to these author identities
  path?: string; // scope path ("" = root)
}

export interface TimelineBucketInfo {
  bucket: "day" | "week" | "month";
}
