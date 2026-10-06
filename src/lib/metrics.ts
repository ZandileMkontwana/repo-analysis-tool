import { createHash } from "node:crypto";
import { db, getRepoRow, type RepoDbRow } from "./db";
import { ApiError } from "./errors";
import type {
  AuthorAgg,
  AuthorGroupRow,
  AuthorRow,
  CommitRow,
  DashboardResponse,
  DirChild,
  MetricsFilters,
  PathStat,
  RepoRef,
  Summary,
  TimelinePoint,
} from "./types";

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const CACHE = new Map<string, unknown>();
const CACHE_MAX = 160;

function cached<T>(key: string, produce: () => T): T {
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit as T;
  const value = produce();
  if (CACHE.size >= CACHE_MAX) {
    const first = CACHE.keys().next().value;
    if (first !== undefined) CACHE.delete(first);
  }
  CACHE.set(key, value);
  return value;
}

export function purgeRepoCache(repoId: number) {
  for (const key of [...CACHE.keys()]) {
    if (key.startsWith(`${repoId}|`)) CACHE.delete(key);
  }
  graphCache.delete(repoId);
  reachCache = new Map([...reachCache].filter(([k]) => !k.startsWith(`${repoId}|`)));
}

function filterSignature(filters: MetricsFilters): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        ref: filters.ref ?? "HEAD",
        from: filters.from ?? null,
        to: filters.to ?? null,
        hashes: filters.hashes && filters.hashes.length > 0 ? [...filters.hashes].sort() : null,
        authors: filters.authorIds && filters.authorIds.length > 0 ? [...filters.authorIds].sort() : null,
      }),
    )
    .digest("hex")
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Commit graph + reachability
// ---------------------------------------------------------------------------

interface RepoGraph {
  idByHash: Map<string, number>;
  hashById: Map<number, string>;
  parentsById: Map<number, number[]>;
  isMerge: Set<number>;
  datesById: Map<number, number>;
  authorById: Map<number, number>;
  allIds: number[];
}

const graphCache = new Map<number, RepoGraph>();
let reachCache = new Map<string, Set<number>>();

function loadGraph(repoId: number): RepoGraph {
  const hit = graphCache.get(repoId);
  if (hit) return hit;
  const rows = db
    .prepare("SELECT id, hash, parents, date, author_id FROM commits WHERE repo_id = ?")
    .all(repoId) as Array<{
    id: number;
    hash: string;
    parents: string;
    date: number;
    author_id: number;
  }>;
  const idByHash = new Map<string, number>();
  const hashById = new Map<number, string>();
  for (const row of rows) {
    idByHash.set(row.hash, row.id);
    hashById.set(row.id, row.hash);
  }
  const parentsById = new Map<number, number[]>();
  const isMerge = new Set<number>();
  const datesById = new Map<number, number>();
  const authorById = new Map<number, number>();
  for (const row of rows) {
    datesById.set(row.id, row.date);
    authorById.set(row.id, row.author_id);
    if (row.parents) {
      const parts = row.parents.split(" ");
      if (parts.length > 1) isMerge.add(row.id);
      const ids: number[] = [];
      for (const p of parts) {
        const pid = idByHash.get(p);
        if (pid !== undefined) ids.push(pid);
      }
      parentsById.set(row.id, ids);
    }
  }
  const graph: RepoGraph = {
    idByHash,
    hashById,
    parentsById,
    isMerge,
    datesById,
    authorById,
    allIds: rows.map((r) => r.id),
  };
  if (graphCache.size > 8) {
    const first = graphCache.keys().next().value;
    if (first !== undefined) graphCache.delete(first);
  }
  graphCache.set(repoId, graph);
  return graph;
}

function reachableFrom(repoId: number, refHash: string): Set<number> {
  const key = `${repoId}|reach|${refHash}`;
  const hit = reachCache.get(key);
  if (hit) return hit;
  const graph = loadGraph(repoId);
  const result = new Set<number>();
  const start = graph.idByHash.get(refHash);
  if (start !== undefined) {
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      const parents = graph.parentsById.get(id);
      if (parents) {
        for (const p of parents) if (!result.has(p)) stack.push(p);
      }
    }
  }
  if (reachCache.size > 32) {
    const first = reachCache.keys().next().value;
    if (first !== undefined) reachCache.delete(first);
  }
  reachCache.set(key, result);
  return result;
}

function resolveRefHash(graph: RepoGraph, row: RepoDbRow, ref?: string): string {
  if (!ref || ref === "HEAD") {
    if (!row.head_hash) throw new ApiError(400, "Repository has no HEAD commit.");
    return row.head_hash;
  }
  let refs: RepoRef[] = [];
  try {
    refs = JSON.parse(row.refs) as RepoRef[];
  } catch {
    refs = [];
  }
  const byName = refs.find((r) => r.name === ref);
  if (byName) return byName.hash;
  if (graph.idByHash.has(ref)) return ref;
  for (const hash of graph.idByHash.keys()) {
    if (hash.startsWith(ref) && ref.length >= 7) return hash;
  }
  throw new ApiError(400, `Unknown reference commit "${ref}".`);
}

export interface ResolvedCommitSet {
  ids: number[];
  size: number;
  refHash: string;
}

/**
 * Resolves the commit set H for the given filters:
 * non-merge commits reachable from the reference commit, further restricted by
 * a manual commit list OR a [from, to) committer-date window, and by author.
 */
export function resolveCommitSet(repoId: number, filters: MetricsFilters): ResolvedCommitSet {
  const sig = filterSignature(filters);
  return cached(`${repoId}|commitset|${sig}`, () => {
    const row = getRepoRow(repoId);
    if (!row) throw new ApiError(404, "Repository not found.");
    const graph = loadGraph(repoId);
    const refHash = resolveRefHash(graph, row, filters.ref);
    const reach = reachableFrom(repoId, refHash);
    let ids = graph.allIds.filter((id) => reach.has(id) && !graph.isMerge.has(id));

    if (filters.hashes && filters.hashes.length > 0) {
      const wanted = new Set<number>();
      for (const h of filters.hashes) {
        const id = graph.idByHash.get(h);
        if (id !== undefined) wanted.add(id);
      }
      ids = ids.filter((id) => wanted.has(id));
    } else if (filters.from !== undefined || filters.to !== undefined) {
      const from = filters.from ?? -Infinity;
      const to = filters.to ?? Infinity;
      ids = ids.filter((id) => {
        const d = graph.datesById.get(id) ?? 0;
        return d >= from && d < to;
      });
    }

    if (filters.authorIds && filters.authorIds.length > 0) {
      const allowed = new Set(filters.authorIds);
      ids = ids.filter((id) => allowed.has(graph.authorById.get(id) ?? -1));
    }
    const resolved: ResolvedCommitSet = { ids, size: ids.length, refHash };
    return resolved;
  });
}

function idsParam(ids: number[]): string {
  return JSON.stringify(ids);
}

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

const COMMIT_SET_CLAUSE = "ch.commit_id IN (SELECT value FROM json_each(?))";

/** WHERE fragment matching scope path (a file path or a directory subtree). */
function scopeClause(scope: string): { sql: string; params: string[] } {
  if (!scope) return { sql: "", params: [] };
  return {
    sql: " AND (ch.path = ? OR (ch.path >= ? AND ch.path < ?))",
    params: [scope, scope + "/", scope + "0"],
  };
}

function withRates<T extends { added: number; removed: number; modifications: number }>(
  row: T,
  commitSetSize: number,
): T & { growth: number; churn: number; frequency: number; churnRate: number } {
  const growth = row.added - row.removed;
  const churn = row.added + row.removed;
  return {
    ...row,
    growth,
    churn,
    frequency: commitSetSize > 0 ? row.modifications / commitSetSize : 0,
    churnRate: commitSetSize > 0 ? churn / commitSetSize : 0,
  };
}

// ---------------------------------------------------------------------------
// Query A: per-path stats for the commit set (scope independent)
// ---------------------------------------------------------------------------

export function getPathStats(repoId: number, filters: MetricsFilters): PathStat[] {
  const sig = filterSignature(filters);
  return cached(`${repoId}|paths|${sig}`, () => {
    const { ids } = resolveCommitSet(repoId, filters);
    if (ids.length === 0) return [];
    const rows = db
      .prepare(
        `SELECT ch.path AS path,
                SUM(ch.added) AS added,
                SUM(ch.removed) AS removed,
                SUM(CASE WHEN ch.added + ch.removed > 0 THEN 1 ELSE 0 END) AS modifications
         FROM changes ch
         WHERE ${COMMIT_SET_CLAUSE}
         GROUP BY ch.path`,
      )
      .all(idsParam(ids)) as Array<{ path: string; added: number; removed: number; modifications: number }>;
    return rows.map((r) => ({
      path: r.path,
      added: r.added,
      removed: r.removed,
      modifications: r.modifications,
      growth: r.added - r.removed,
      churn: r.added + r.removed,
    }));
  });
}

// ---------------------------------------------------------------------------
// Query B: immediate children of a scope (files + directories)
// ---------------------------------------------------------------------------

export function getScopeChildren(
  repoId: number,
  filters: MetricsFilters,
  scope: string,
): DirChild[] {
  const sig = filterSignature(filters);
  return cached(`${repoId}|children|${sig}|${scope}`, () => {
    const { ids, size } = resolveCommitSet(repoId, filters);
    if (ids.length === 0) return [];
    const scopeFilter = scopeClause(scope);
    // substr() is 1-based: skip "scope/" so `rest` begins at the first child
    // segment (root scope keeps the whole path as `rest`).
    const start = scope.length === 0 ? 1 : scope.length + 2;
    const rows = db
      .prepare(
        `SELECT CASE WHEN instr(rest, '/') > 0 THEN substr(rest, 1, instr(rest, '/') - 1) ELSE rest END AS name,
                (instr(rest, '/') > 0) AS is_dir,
                SUM(ch.added) AS added,
                SUM(ch.removed) AS removed,
                COUNT(DISTINCT CASE WHEN ch.added + ch.removed > 0 THEN ch.commit_id END) AS modifications
         FROM (
           SELECT substr(ch.path, ?) AS rest, ch.added AS added, ch.removed AS removed, ch.commit_id AS commit_id
           FROM changes ch
           WHERE ${COMMIT_SET_CLAUSE}${scopeFilter.sql}
         ) ch
         GROUP BY name, is_dir`,
      )
      .all(start, idsParam(ids), ...scopeFilter.params) as Array<{
      name: string;
      is_dir: number;
      added: number;
      removed: number;
      modifications: number;
    }>;
    return rows.map((r) =>
      withRates(
        {
          name: r.name,
          path: scope ? `${scope}/${r.name}` : r.name,
          isDir: r.is_dir === 1,
          added: r.added,
          removed: r.removed,
          modifications: r.modifications,
        },
        size,
      ),
    );
  });
}

// ---------------------------------------------------------------------------
// Query C: summary for a scope
// ---------------------------------------------------------------------------

export function getScopeSummary(
  repoId: number,
  filters: MetricsFilters,
): Summary {
  const sig = filterSignature(filters);
  const scope = filters.path ?? "";
  return cached(`${repoId}|summary|${sig}|${scope}`, () => {
    const { ids, size } = resolveCommitSet(repoId, filters);
    const scopeFilter = scopeClause(scope);
    const totals =
      ids.length === 0
        ? { added: 0, removed: 0, modifications: 0 }
        : (db
            .prepare(
              `SELECT COALESCE(SUM(ch.added), 0) AS added,
                      COALESCE(SUM(ch.removed), 0) AS removed,
                      COUNT(DISTINCT CASE WHEN ch.added + ch.removed > 0 THEN ch.commit_id END) AS modifications
               FROM changes ch
               WHERE ${COMMIT_SET_CLAUSE}${scopeFilter.sql}`,
            )
            .get(idsParam(ids), ...scopeFilter.params) as {
            added: number;
            removed: number;
            modifications: number;
          });
    const authors =
      ids.length === 0
        ? 0
        : (db
            .prepare(
              `SELECT COUNT(DISTINCT author_id) AS c FROM commits WHERE id IN (SELECT value FROM json_each(?))`,
            )
            .get(idsParam(ids)) as { c: number }).c;
    const base = withRates(
      {
        added: totals.added,
        removed: totals.removed,
        modifications: totals.modifications,
        commitSetSize: size,
        authors,
      },
      size,
    );
    const summary: Summary = {
      added: base.added,
      removed: base.removed,
      growth: base.growth,
      churn: base.churn,
      modifications: base.modifications,
      frequency: base.frequency,
      churnRate: base.churnRate,
      commitSetSize: size,
      authors,
    };
    return summary;
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export function getTimeline(repoId: number, filters: MetricsFilters): TimelinePoint[] {
  const sig = filterSignature(filters);
  const scope = filters.path ?? "";
  return cached(`${repoId}|timeline|${sig}|${scope}`, () => {
    const { ids } = resolveCommitSet(repoId, filters);
    if (ids.length === 0) return [];
    const scopeFilter = scopeClause(scope);
    const rows = db
      .prepare(
        `SELECT (c.date / 86400) * 86400 AS day,
                COALESCE(SUM(ch.added), 0) AS added,
                COALESCE(SUM(ch.removed), 0) AS removed,
                COUNT(DISTINCT ch.commit_id) AS commits
         FROM changes ch
         JOIN commits c ON c.id = ch.commit_id
         WHERE ${COMMIT_SET_CLAUSE}${scopeFilter.sql}
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(idsParam(ids), ...scopeFilter.params) as Array<{
      day: number;
      added: number;
      removed: number;
      commits: number;
    }>;
    return rows.map((r) => ({
      day: r.day,
      added: r.added,
      removed: r.removed,
      commits: r.commits,
    }));
  });
}

// ---------------------------------------------------------------------------
// Author metrics
// ---------------------------------------------------------------------------

interface AuthorGroupInfo {
  authorToGroup: Map<number, { id: number; label: string }>;
  membersByGroup: Map<number, number[]>;
}

function getAuthorGroups(repoId: number): AuthorGroupInfo {
  return cached(`${repoId}|autgroups`, () => {
    const rows = db
      .prepare(
        `SELECT g.id AS group_id, g.label AS label, m.author_id AS author_id
         FROM author_groups g
         LEFT JOIN author_group_members m ON m.group_id = g.id
         WHERE g.repo_id = ?`,
      )
      .all(repoId) as Array<{ group_id: number; label: string; author_id: number | null }>;
    const authorToGroup = new Map<number, { id: number; label: string }>();
    const membersByGroup = new Map<number, number[]>();
    for (const row of rows) {
      if (!membersByGroup.has(row.group_id)) membersByGroup.set(row.group_id, []);
      if (row.author_id !== null) {
        authorToGroup.set(row.author_id, { id: row.group_id, label: row.label });
        membersByGroup.get(row.group_id)!.push(row.author_id);
      }
    }
    return { authorToGroup, membersByGroup };
  });
}

export function getAuthors(
  repoId: number,
  filters: MetricsFilters,
): AuthorAgg[] {
  const sig = filterSignature(filters);
  const scope = filters.path ?? "";
  return cached(`${repoId}|authors|${sig}|${scope}`, () => {
    const { ids, size } = resolveCommitSet(repoId, filters);
    if (ids.length === 0) return [];
    const scopeFilter = scopeClause(scope);
    const rows = db
      .prepare(
        `SELECT c.author_id AS author_id, a.name AS name, a.email AS email,
                COALESCE(SUM(ch.added), 0) AS added,
                COALESCE(SUM(ch.removed), 0) AS removed,
                COUNT(DISTINCT CASE WHEN ch.added + ch.removed > 0 THEN ch.commit_id END) AS modifications
         FROM changes ch
         JOIN commits c ON c.id = ch.commit_id
         JOIN authors a ON a.id = c.author_id
         WHERE ${COMMIT_SET_CLAUSE}${scopeFilter.sql}
         GROUP BY c.author_id`,
      )
      .all(idsParam(ids), ...scopeFilter.params) as Array<{
      author_id: number;
      name: string;
      email: string;
      added: number;
      removed: number;
      modifications: number;
    }>;
    const commitCounts = new Map<number, number>();
    const countRows = db
      .prepare(
        `SELECT author_id, COUNT(*) AS c FROM commits
         WHERE id IN (SELECT value FROM json_each(?))
         GROUP BY author_id`,
      )
      .all(idsParam(ids)) as Array<{ author_id: number; c: number }>;
    for (const r of countRows) commitCounts.set(r.author_id, r.c);

    const totalChurn = rows.reduce((acc, r) => acc + r.added + r.removed, 0);
    const groups = getAuthorGroups(repoId);
    // Merge rows by effective identity: a group if the author belongs to one,
    // otherwise the author itself. Member churn/modifications sum directly
    // (each commit has exactly one author, so nothing double-counts).
    interface Acc {
      authorId: number | null;
      key: string;
      isGroup: boolean;
      memberIds: number[];
      name: string;
      email: string;
      added: number;
      removed: number;
      modifications: number;
      commits: number;
      groupId: number | null;
      groupLabel: string | null;
    }
    const byKey = new Map<string, Acc>();
    for (const r of rows) {
      const group = groups.authorToGroup.get(r.author_id) ?? null;
      const key = group ? `g:${group.id}` : `a:${r.author_id}`;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          authorId: group ? null : r.author_id,
          key,
          isGroup: group !== null,
          memberIds: [],
          name: group ? group.label : r.name,
          email: group ? "" : r.email,
          added: 0,
          removed: 0,
          modifications: 0,
          commits: 0,
          groupId: group?.id ?? null,
          groupLabel: group?.label ?? null,
        };
        byKey.set(key, acc);
      }
      acc.memberIds.push(r.author_id);
      acc.added += r.added;
      acc.removed += r.removed;
      acc.modifications += r.modifications;
      acc.commits += commitCounts.get(r.author_id) ?? 0;
    }
    const result: AuthorAgg[] = [...byKey.values()].map((acc) => {
      if (acc.isGroup && acc.groupId !== null) {
        // Use full membership so the UI filters by every member id, and sum
        // in-set commit counts across members (incl. zero-change commits).
        acc.memberIds = groups.membersByGroup.get(acc.groupId) ?? acc.memberIds;
        acc.commits = acc.memberIds.reduce((s, id) => s + (commitCounts.get(id) ?? 0), 0);
      }
      const churn = acc.added + acc.removed;
      return {
        ...acc,
        growth: acc.added - acc.removed,
        churn,
        frequency: size > 0 ? acc.modifications / size : 0,
        churnRate: size > 0 ? churn / size : 0,
        ownership: totalChurn > 0 ? churn / totalChurn : 0,
      };
    });
    result.sort((a, b) => b.churn - a.churn || a.name.localeCompare(b.name));
    return result;
  });
}

/** All distinct author identities of the repo (with commit counts in H). */
export function getAuthorList(
  repoId: number,
  filters: MetricsFilters,
): AuthorRow[] {
  const sig = filterSignature(filters);
  return cached(`${repoId}|authorlist|${sig}`, () => {
    const { ids } = resolveCommitSet(repoId, filters);
    const groups = getAuthorGroups(repoId);
    const countRows = db
      .prepare(
        `SELECT author_id, COUNT(*) AS c FROM commits
         WHERE id IN (SELECT value FROM json_each(?))
         GROUP BY author_id`,
      )
      .all(idsParam(ids)) as Array<{ author_id: number; c: number }>;
    const counts = new Map<number, number>();
    for (const r of countRows) counts.set(r.author_id, r.c);
    const authors = db
      .prepare("SELECT id, name, email FROM authors WHERE repo_id = ? ORDER BY name, email")
      .all(repoId) as Array<{ id: number; name: string; email: string }>;
    return authors.map((a) => {
      const group = groups.authorToGroup.get(a.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        commitsInSet: counts.get(a.id) ?? 0,
        groupId: group?.id ?? null,
        groupLabel: group?.label ?? null,
      } as AuthorRow & { commitsInSet: number };
    });
  });
}

export function getAuthorGroupsList(repoId: number): AuthorGroupRow[] {
  return cached(`${repoId}|grouplist`, () => {
    const groups = db
      .prepare("SELECT id, label FROM author_groups WHERE repo_id = ? ORDER BY label")
      .all(repoId) as Array<{ id: number; label: string }>;
    const members = db
      .prepare(
        `SELECT m.group_id, m.author_id FROM author_group_members m
         JOIN author_groups g ON g.id = m.group_id
         WHERE g.repo_id = ?`,
      )
      .all(repoId) as Array<{ group_id: number; author_id: number }>;
    return groups.map((g) => ({
      id: g.id,
      label: g.label,
      members: members.filter((m) => m.group_id === g.id).map((m) => m.author_id),
    }));
  });
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export function getDashboard(repoId: number, filters: MetricsFilters): DashboardResponse {
  const scope = filters.path ?? "";
  const stats = getPathStats(repoId, filters);
  const scopeIsDir = !stats.some((s) => s.path === scope);
  const summary = getScopeSummary(repoId, filters);
  const children = scopeIsDir ? getScopeChildren(repoId, filters, scope) : [];
  const timeline = getTimeline(repoId, filters);
  const topAuthors = getAuthors(repoId, filters).slice(0, 14);
  return {
    summary,
    scope,
    scopeIsDir,
    children,
    timeline,
    topAuthors,
  };
}

// ---------------------------------------------------------------------------
// File listing (sorted/paginated in JS from cached path stats)
// ---------------------------------------------------------------------------

export type FileSortKey =
  | "path"
  | "added"
  | "removed"
  | "growth"
  | "churn"
  | "modifications";

export interface FileListOptions {
  scope?: string;
  q?: string;
  sort?: FileSortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function listFiles(
  repoId: number,
  filters: MetricsFilters,
  options: FileListOptions,
) {
  const { size } = resolveCommitSet(repoId, filters);
  const scope = options.scope ?? "";
  const q = (options.q ?? "").trim().toLowerCase();
  const sort = options.sort ?? "churn";
  const dir = options.dir === "asc" ? 1 : -1;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(500, Math.max(5, options.pageSize ?? 50));

  let rows = getPathStats(repoId, filters);
  if (scope) {
    const prefix = scope + "/";
    rows = rows.filter((r) => r.path.startsWith(prefix));
  }
  if (q) {
    rows = rows.filter((r) => r.path.toLowerCase().includes(q));
  }
  const sorted = [...rows].sort((a, b) => {
    if (sort === "path") return dir * a.path.localeCompare(b.path);
    const av = a[sort];
    const bv = b[sort];
    if (av !== bv) return dir * ((av as number) - (bv as number));
    return a.path.localeCompare(b.path);
  });
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize).map((r) => withRates(r, size));
  return { rows: pageRows, total, page, pageSize, commitSetSize: size };
}

// ---------------------------------------------------------------------------
// Commit listing
// ---------------------------------------------------------------------------

export interface CommitListOptions {
  q?: string;
  page?: number;
  pageSize?: number;
  authorIds?: number[];
}

export function listCommits(
  repoId: number,
  filters: MetricsFilters,
  options: CommitListOptions,
) {
  const { ids, size } = resolveCommitSet(repoId, filters);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, options.pageSize ?? 50));
  if (ids.length === 0) return { rows: [], total: 0, page, pageSize, commitSetSize: size };

  const conditions: string[] = ["c.id IN (SELECT value FROM json_each(?))"];
  const params: Array<string | number> = [idsParam(ids)];
  if (options.authorIds && options.authorIds.length > 0) {
    const placeholders = options.authorIds.map(() => "?").join(",");
    conditions.push(`c.author_id IN (${placeholders})`);
    params.push(...options.authorIds);
  }
  const q = (options.q ?? "").trim();
  if (q) {
    conditions.push("(c.subject LIKE ? OR c.hash LIKE ?)");
    params.push(`%${q}%`, `${q}%`);
  }
  const where = conditions.join(" AND ");

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM commits c WHERE ${where}`).get(...params) as {
      c: number;
    }
  ).c;

  const rows = db
    .prepare(
      `SELECT c.id AS id, c.hash AS hash, c.date AS date, c.subject AS subject,
              c.author_id AS authorId, a.name AS authorName, a.email AS authorEmail,
              (SELECT COALESCE(SUM(ch.added), 0) FROM changes ch WHERE ch.commit_id = c.id) AS added,
              (SELECT COALESCE(SUM(ch.removed), 0) FROM changes ch WHERE ch.commit_id = c.id) AS removed,
              (SELECT COUNT(*) FROM changes ch WHERE ch.commit_id = c.id) AS files
       FROM commits c
       JOIN authors a ON a.id = c.author_id
       WHERE ${where}
       ORDER BY c.date DESC, c.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as CommitRow[];
  return { rows, total, page, pageSize, commitSetSize: size };
}
