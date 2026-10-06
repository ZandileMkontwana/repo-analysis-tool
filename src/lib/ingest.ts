import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { db, getRepoRow, REPOS_DIR } from "./db";
import { runGit, spawnGit, tailLines, tryGit } from "./git";
import { ApiError } from "./errors";
import type { RepoRef } from "./types";

const HEADER_MARK = "\u0001";
const FIELD_SEP = "\u001f";

// ---------------------------------------------------------------------------
// Repo creation
// ---------------------------------------------------------------------------

export function isValidRepoUrl(url: string): boolean {
  if (!/^(https?:\/\/|git@[^:]+:|ssh:\/\/|git:\/\/|file:\/\/)/i.test(url)) return false;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function deriveName(url: string): string {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const seg = cleaned.split(/[/:]/).filter(Boolean).pop() || "repository";
  return seg;
}

export function createRepoFromUrl(url: string): number {
  const clean = url.trim();
  if (!isValidRepoUrl(clean)) {
    throw new ApiError(
      400,
      "Enter a valid repository URL (https://, git@host:path, ssh:// or git://).",
    );
  }
  const info = db
    .prepare(
      "INSERT INTO repos (name, source_kind, source, path, status, progress, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(deriveName(clean), "url", clean, "", "pending", "{}", Math.floor(Date.now() / 1000));
  const id = Number(info.lastInsertRowid);
  void runIngestion(id).catch(() => {});
  return id;
}

export function createRepoFromZip(zipPath: string, originalName: string): number {
  const name = originalName.replace(/\.zip$/i, "").trim() || "uploaded-repo";
  const info = db
    .prepare(
      "INSERT INTO repos (name, source_kind, source, path, status, progress, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(name, "zip", originalName, "", "pending", "{}", Math.floor(Date.now() / 1000));
  const id = Number(info.lastInsertRowid);
  void runIngestion(id, zipPath).catch(() => {});
  return id;
}

function updateRepo(id: number, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sql = `UPDATE repos SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), id);
}

// ---------------------------------------------------------------------------
// Ingestion worker
// ---------------------------------------------------------------------------

export async function runIngestion(repoId: number, zipPath?: string): Promise<void> {
  const row = getRepoRow(repoId);
  if (!row) return;
  const repoPath = path.join(REPOS_DIR, `repo-${repoId}`);
  try {
    if (row.source_kind === "url") {
      updateRepo(repoId, {
        status: "cloning",
        progress: JSON.stringify({ phase: "Cloning repository", pct: 0 }),
      });
      await cloneBare(row.source, repoPath, (pct) => {
        updateRepo(repoId, {
          progress: JSON.stringify({ phase: "Cloning repository", pct }),
        });
      });
    } else {
      updateRepo(repoId, {
        status: "extracting",
        progress: JSON.stringify({ phase: "Extracting archive" }),
      });
      if (!zipPath || !fs.existsSync(zipPath)) {
        throw new Error("Uploaded archive is missing on disk.");
      }
      await extractZip(zipPath, repoPath);
      fs.rmSync(zipPath, { force: true });
    }

    const cwd = findGitRoot(repoPath);
    if (!cwd) {
      throw new Error(
        "No Git repository found in the archive. Include the .git directory in the zip.",
      );
    }
    // Validate it is a real git repository we can read.
    await runGit(["rev-parse", "--git-dir"], cwd);
    updateRepo(repoId, { path: cwd });

    const headHash = (await runGit(["rev-parse", "HEAD"], cwd)).trim();
    if (!headHash) throw new Error("Repository has no commits (HEAD could not be resolved).");

    const defaultBranch =
      (await tryGit(["symbolic-ref", "--short", "HEAD"], cwd))?.trim() || null;
    const refs = await listRefs(cwd, headHash);

    const totalRaw = await runGit(["rev-list", "--count", "--all"], cwd);
    const total = parseInt(totalRaw.trim(), 10) || 0;

    updateRepo(repoId, {
      status: "parsing",
      head_hash: headHash,
      default_branch: defaultBranch,
      refs: JSON.stringify(refs),
      progress: JSON.stringify({ phase: "Parsing history", done: 0, total }),
    });

    const parseErrors = await parseHistory(repoId, cwd, total);

    const commitCount = (
      db.prepare("SELECT COUNT(*) AS c FROM commits WHERE repo_id = ?").get(repoId) as {
        c: number;
      }
    ).c;
    const changeRows = (
      db.prepare(
        "SELECT COUNT(*) AS c FROM changes WHERE commit_id IN (SELECT id FROM commits WHERE repo_id = ?)",
      ).get(repoId) as { c: number }
    ).c;
    const authorCount = (
      db.prepare("SELECT COUNT(*) AS c FROM authors WHERE repo_id = ?").get(repoId) as {
        c: number;
      }
    ).c;

    updateRepo(repoId, {
      status: "ready",
      error: null,
      stats: JSON.stringify({
        commits: commitCount,
        changeRows,
        authors: authorCount,
        parseErrors,
      }),
      progress: JSON.stringify({ phase: "Ready", pct: 100 }),
    });
  } catch (e) {
    const message =
      e instanceof Error
        ? [e.message, "stderr" in e ? String((e as { stderr?: string }).stderr || "") : ""]
            .filter(Boolean)
            .join(" — ")
        : String(e);
    updateRepo(repoId, {
      status: "error",
      error: tailLines(message, 6),
      progress: JSON.stringify({ phase: "Failed" }),
    });
  }
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

function cloneBare(
  url: string,
  dest: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--bare", "--progress", "--", url, dest], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stderrBuf = "";
    let maxPct = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf = (stderrBuf + text).slice(-8000);
      const matches = [...text.matchAll(/(?:Receiving objects|Resolving deltas):\s+(\d+)%/g)];
      for (const m of matches) {
        const pct = Number(m[1]);
        if (pct > maxPct) {
          maxPct = pct;
          onProgress(pct);
        }
      }
    });
    child.on("error", (err) => reject(new Error(`Failed to run git clone: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const hint = /could not resolve host|unable to access/i.test(stderrBuf)
        ? "Check the URL and that the repository is publicly accessible."
        : "";
      reject(
        new Error(
          `git clone failed. ${tailLines(stderrBuf, 3)}${hint ? ` — ${hint}` : ""}`,
        ),
      );
    });
  });
}

function extractZip(zipPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true });
    const child = spawn("unzip", ["-q", "-o", zipPath, "-d", dest], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderrBuf = "";
    child.stderr.on("data", (c: Buffer) => {
      stderrBuf = (stderrBuf + c.toString()).slice(-4000);
    });
    child.on("error", (err) => reject(new Error(`Failed to run unzip: ${err.message}`)));
    child.on("close", (code) => {
      // unzip exits 1 for warnings (e.g. extra bytes); treat >= 2 as failure.
      if (code === 0 || code === 1) return resolve();
      reject(new Error(`Could not extract the zip archive. ${tailLines(stderrBuf, 3)}`));
    });
  });
}

function findGitRoot(base: string): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
  const bareCandidates: string[] = [];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (isBareGitDir(dir)) bareCandidates.push(dir);
    if (depth >= 3) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === ".git" || entry.name === "__MACOSX" || entry.name === "node_modules") {
        continue;
      }
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return bareCandidates[0] ?? null;
}

function isBareGitDir(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "HEAD")) &&
    fs.existsSync(path.join(dir, "objects")) &&
    fs.existsSync(path.join(dir, "refs"))
  );
}

async function listRefs(cwd: string, headHash: string): Promise<RepoRef[]> {
  const refs: RepoRef[] = [{ name: "HEAD", type: "head", hash: headHash }];
  const raw = await runGit(
    [
      "for-each-ref",
      `--format=%(refname:short)${FIELD_SEP}%(objecttype)${FIELD_SEP}%(objectname)${FIELD_SEP}%(*objectname)`,
      "refs/heads",
      "refs/tags",
    ],
    cwd,
  );
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [name, type, objectName, peeled] = line.split(FIELD_SEP);
    const hash = type === "tag" && peeled ? peeled : objectName;
    refs.push({ name, type: type === "tag" ? "tag" : "branch", hash });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// History parsing (single streamed `git log --numstat` pass)
// ---------------------------------------------------------------------------

interface ParsedCommit {
  hash: string;
  parents: string;
  authorId: number;
  date: number;
  subject: string;
  changes: Array<{ path: string; added: number; removed: number }>;
}

async function parseHistory(repoId: number, cwd: string, total: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const args = [
      "-c",
      "core.quotePath=false",
      "-c",
      "diff.renameLimit=5000",
      "log",
      "--all",
      "--numstat",
      "-M50%",
      "--no-color",
      `--format=${HEADER_MARK}%H${FIELD_SEP}%P${FIELD_SEP}%ct${FIELD_SEP}%aN${FIELD_SEP}%aE${FIELD_SEP}%s`,
    ];
    const child = spawnGit(args, cwd);
    const decoder = new StringDecoder("utf8");

    const insertCommit = db.prepare(
      "INSERT OR IGNORE INTO commits (repo_id, hash, parents, author_id, date, subject) VALUES (?,?,?,?,?,?)",
    );
    const insertChange = db.prepare(
      "INSERT INTO changes (commit_id, path, added, removed) VALUES (?,?,?,?)",
    );
    const insertAuthor = db.prepare(
      "INSERT OR IGNORE INTO authors (repo_id, name, email) VALUES (?,?,?)",
    );
    const getAuthor = db.prepare("SELECT id FROM authors WHERE repo_id = ? AND name = ? AND email = ?");
    const authorCache = new Map<string, number>();

    const flushBatch = db.transaction((commits: ParsedCommit[]) => {
      for (const commit of commits) {
        const info = insertCommit.run(
          repoId,
          commit.hash,
          commit.parents,
          commit.authorId,
          commit.date,
          commit.subject,
        );
        const commitId = Number(info.lastInsertRowid);
        if (commitId > 0) {
          for (const change of commit.changes) {
            insertChange.run(commitId, change.path, change.added, change.removed);
          }
        }
      }
    });

    let batch: ParsedCommit[] = [];
    let current: ParsedCommit | null = null;
    let processed = 0;
    let parseErrors = 0;
    let stderrBuf = "";
    let buf = "";

    const flush = (force: boolean) => {
      if (batch.length === 0) return;
      if (!force && batch.length < 3000) return;
      flushBatch(batch);
      batch = [];
      updateRepo(repoId, {
        progress: JSON.stringify({ phase: "Parsing history", done: processed, total }),
      });
    };

    const resolveAuthor = (name: string, email: string): number => {
      const key = `${name}${FIELD_SEP}${email}`;
      let id = authorCache.get(key);
      if (id === undefined) {
        insertAuthor.run(repoId, name, email);
        id = (getAuthor.get(repoId, name, email) as { id: number }).id;
        authorCache.set(key, id);
      }
      return id;
    };

    const handleLine = (line: string) => {
      if (line.length === 0) return;
      if (line.startsWith(HEADER_MARK)) {
        if (current) batch.push(current);
        const parts = line.slice(1).split(FIELD_SEP);
        const hash = parts[0] ?? "";
        const parents = parts[1] ?? "";
        const date = Number(parts[2]) || 0;
        const authorName = parts[3] ?? "";
        const authorEmail = parts[4] ?? "";
        const subject = parts.slice(5).join(FIELD_SEP);
        if (!hash) {
          parseErrors++;
          current = null;
          return;
        }
        current = {
          hash,
          parents,
          authorId: resolveAuthor(authorName, authorEmail),
          date,
          subject,
          changes: [],
        };
        processed++;
        if (processed % 2000 === 0) {
          flush(true);
        } else if (batch.length >= 3000) {
          flush(true);
        }
        return;
      }
      if (!current) return;
      const parsed = parseNumstatLine(line);
      if (parsed) {
        current.changes.push(parsed);
      } else if (!NUMSTAT_RE.test(line)) {
        parseErrors++;
      }
      // else: binary entry ("-\t-") — excluded from metrics by design.
    };

    child.stdout.on("data", (chunk: Buffer) => {
      buf += decoder.write(chunk);
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        handleLine(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf = (stderrBuf + chunk.toString()).slice(-8000);
    });
    child.on("error", (err) => reject(new Error(`git log failed to start: ${err.message}`)));
    child.on("close", (code) => {
      buf += decoder.end();
      if (buf.length > 0) handleLine(buf);
      if (current) batch.push(current);
      try {
        flushBatch(batch);
      } catch (e) {
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
      if (code === 0) resolve(parseErrors);
      else reject(new Error(`git log exited with code ${code}: ${tailLines(stderrBuf, 3)}`));
    });
  });
}

// ---------------------------------------------------------------------------
// numstat line parsing
// ---------------------------------------------------------------------------

const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

export function parseNumstatLine(
  line: string,
): { path: string; added: number; removed: number } | null {
  const m = NUMSTAT_RE.exec(line);
  if (!m) return null;
  const [, addedRaw, removedRaw, field] = m;
  if (addedRaw === "-" || removedRaw === "-") return null; // binary file: not measured
  const p = parseChangedPath(field);
  if (p === null) return null;
  return { path: p, added: parseInt(addedRaw, 10), removed: parseInt(removedRaw, 10) };
}

/**
 * Resolves the (new) path of a numstat path field, handling git rename
 * compression (`old => new`, `pre{a => b}suf`) and C-style quoted paths.
 * Per the brief, changes on a rename are attributed to the new path.
 */
export function parseChangedPath(field: string): string | null {
  const arrow = " => ";
  const idx = field.lastIndexOf(arrow);
  let out = field;
  if (idx >= 0) {
    const braceStart = field.lastIndexOf("{", idx);
    const braceEnd = field.indexOf("}", idx);
    if (braceStart >= 0 && braceEnd > idx && braceStart < idx) {
      const newPart = field.slice(idx + arrow.length, braceEnd);
      out = field.slice(0, braceStart) + unquoteGit(newPart) + field.slice(braceEnd + 1);
    } else {
      out = field.slice(idx + arrow.length);
    }
  }
  const result = unquoteGit(out);
  return result.length > 0 ? result : null;
}

/** Unquotes git's C-style path quoting ("a\tb" -> `a<TAB>b`). */
export function unquoteGit(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const inner = value.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    const esc = inner[i];
    switch (esc) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "a": out += "\x07"; break;
      case "\\": out += "\\"; break;
      case '"': out += '"'; break;
      case undefined: break;
      default: {
        if (esc >= "0" && esc <= "7") {
          let oct = esc;
          while (oct.length < 3 && inner[i + 1] >= "0" && inner[i + 1] <= "7") {
            oct += inner[++i];
          }
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += esc;
        }
      }
    }
  }
  return out;
}
