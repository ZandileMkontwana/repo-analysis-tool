import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
export const REPOS_DIR = path.join(DATA_DIR, "repos");
export const TMP_DIR = path.join(DATA_DIR, "tmp");
const DB_PATH = path.join(DATA_DIR, "rat.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  progress TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  head_hash TEXT,
  default_branch TEXT,
  refs TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  UNIQUE(repo_id, name, email)
);

CREATE TABLE IF NOT EXISTS author_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS author_group_members (
  group_id INTEGER NOT NULL REFERENCES author_groups(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, author_id)
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  parents TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL REFERENCES authors(id),
  date INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commits_repo_hash ON commits(repo_id, hash);
CREATE INDEX IF NOT EXISTS idx_commits_repo_date ON commits(repo_id, date);
CREATE INDEX IF NOT EXISTS idx_commits_repo_author ON commits(repo_id, author_id);

CREATE TABLE IF NOT EXISTS changes (
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changes_commit ON changes(commit_id);
CREATE INDEX IF NOT EXISTS idx_changes_path ON changes(path);
`;

function init(): Database.Database {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const database = new Database(DB_PATH);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = ON");
  database.pragma("temp_store = MEMORY");
  database.exec(SCHEMA);
  return database;
}

const g = globalThis as unknown as { __ratDb?: Database.Database };
export const db: Database.Database = (g.__ratDb ??= init());

export interface RepoDbRow {
  id: number;
  name: string;
  source_kind: string;
  source: string;
  path: string;
  status: string;
  progress: string;
  error: string | null;
  head_hash: string | null;
  default_branch: string | null;
  refs: string;
  stats: string;
  created_at: number;
}

export function getRepoRow(id: number): RepoDbRow | undefined {
  return db
    .prepare("SELECT * FROM repos WHERE id = ?")
    .get(id) as RepoDbRow | undefined;
}

export function repoToJson(row: RepoDbRow) {
  return {
    id: row.id,
    name: row.name,
    sourceKind: row.source_kind as "url" | "zip",
    source: row.source,
    status: row.status,
    progress: safeParse(row.progress, {}),
    error: row.error,
    headHash: row.head_hash,
    defaultBranch: row.default_branch,
    refs: safeParse(row.refs, []),
    stats: safeParse(row.stats, {}),
    createdAt: row.created_at,
  };
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
