import { execFile, spawn } from "node:child_process";

export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

export class GitError extends Error {
  stderr: string;
  constructor(message: string, stderr = "") {
    super(message);
    this.name = "GitError";
    this.stderr = stderr;
  }
}

export interface GitResult {
  stdout: string;
  stderr: string;
}

export function runGitFull(args: string[], cwd?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env: gitEnv(), maxBuffer: 128 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new GitError(
              `git ${args.slice(0, 4).join(" ")} failed`,
              String(stderr || (err as Error).message).trim(),
            ),
          );
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}

export async function runGit(args: string[], cwd?: string): Promise<string> {
  return (await runGitFull(args, cwd)).stdout;
}

export async function tryGit(args: string[], cwd?: string): Promise<string | null> {
  try {
    return await runGit(args, cwd);
  } catch {
    return null;
  }
}

/** Spawns git with piped stdio; used for the streamed history pass and clone. */
export function spawnGit(args: string[], cwd?: string) {
  return spawn("git", args, {
    cwd,
    env: gitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Keeps only the last `lines` non-empty lines of a stderr buffer (for error messages). */
export function tailLines(text: string, lines = 4): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .slice(-lines)
    .join("\n");
}
