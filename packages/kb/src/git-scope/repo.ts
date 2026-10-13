// Repository resolution for the git scope (design G1, G3): worktree-independent
// repoKey from the git common dir, remote → forge identity, the per-repo index
// directory (0700) and database file (0600). Nothing here writes inside the repo.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ForgeKind, GitConfig } from "../config.js";
import type { GitExecError, GitScopeDeps } from "./deps.js";

/** Public hosts → forge. Copied (not imported) from
 *  packages/extension/src/git-link-builder.ts `detectPlatform`: keep in sync. */
const PUBLIC_HOSTS: Record<string, ForgeKind> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "codeberg.org": "gitea",
  "gitea.com": "gitea",
};

export type ForgeResolution =
  | { kind: "ok"; forge: ForgeKind; host: string; hostname: string; segments: string[]; identity: string }
  | { kind: "unsupported"; reason: string };

export interface ResolvedRepo {
  repoKey: string;
  commonDir: string;
  toplevel: string;
  /** Per-repo index directory under baseDir. */
  dir: string;
  dbPath: string;
  /** Sidecar whose mtime records "a forge-changing command just ran". */
  hintPath: string;
  forge: ForgeResolution;
}
export type RepoResult = { ok: true; repo: ResolvedRepo } | { ok: false; kind: "disabled" | "unavailable"; reason: string };

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** `https://h/o/r.git`, `ssh://git@h:22/o/r.git`, `git@h:o/r.git` → host + path segments. */
function parseRemoteUrl(url: string): { scheme: "http" | "https" | "ssh"; host: string; hostname: string; path: string } | null {
  const u = url.trim();
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(u);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return { scheme: "ssh", host: scp[1].toLowerCase(), hostname: scp[1].toLowerCase(), path: scp[2] };
  try {
    const parsed = new URL(u);
    const proto = parsed.protocol.replace(":", "");
    if (!["http", "https", "ssh", "git"].includes(proto)) return null;
    const hostname = parsed.hostname.toLowerCase();
    // an ssh/git port is not the API port: keep a port only for http(s) remotes
    const host = proto === "http" || proto === "https" ? parsed.host.toLowerCase() : hostname;
    return { scheme: proto === "http" || proto === "https" ? proto : "ssh", host, hostname, path: parsed.pathname.replace(/^\/+/, "") };
  } catch {
    return null;
  }
}

/** Remote URL → forge identity, or why it is unsupported. */
function resolveForge(remoteUrl: string | null, cfg: GitConfig): ForgeResolution {
  if (!remoteUrl) return { kind: "unsupported", reason: "no remote" };
  const p = parseRemoteUrl(remoteUrl);
  if (!p) return { kind: "unsupported", reason: "unparseable remote" };
  const hosts = cfg.forge.hosts;
  const forge = hosts[p.host] ?? hosts[p.hostname] ?? PUBLIC_HOSTS[p.hostname];
  if (!forge) return { kind: "unsupported", reason: `host ${p.hostname} has no forge adapter` };
  const segments = p.path.replace(/\.git\/?$/, "").replace(/\/+$/, "").split("/");
  const lastOk = segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..");
  const lenOk = forge === "gitlab" ? segments.length >= 2 : segments.length === 2;
  if (!lastOk || !lenOk) return { kind: "unsupported", reason: "invalid repository path" };
  return { kind: "ok", forge, host: p.host, hostname: p.hostname, segments, identity: `${p.host}/${segments.join("/")}`.toLowerCase() };
}

/** `0700` dir + pre-created `0600` db (SQLite adopts the main file's mode for -wal/-shm). */
export function ensureRepoDir(repo: Pick<ResolvedRepo, "dir" | "dbPath">, baseDir: string): void {
  for (const d of [baseDir, repo.dir]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    try {
      chmodSync(d, 0o700);
    } catch { /* non-POSIX fs */ }
  }
  if (!existsSync(repo.dbPath)) closeSync(openSync(repo.dbPath, "a", 0o600));
  try {
    chmodSync(repo.dbPath, 0o600);
  } catch { /* non-POSIX fs */ }
}

/** Resolve the session repository. `git.enabled` is checked before any command runs. */
export function resolveRepo(cwd: string, cfg: GitConfig, deps: GitScopeDeps): RepoResult {
  if (!cfg.enabled) return { ok: false, kind: "disabled", reason: "git scope disabled (git.enabled is false)" };
  if (!existsSync(cwd)) return { ok: false, kind: "unavailable", reason: "directory removed" };
  let out: string;
  try {
    out = deps.git(["rev-parse", "--git-common-dir", "--show-toplevel"], cwd);
  } catch (e) {
    const ge = e as GitExecError;
    if (ge.code === "ENOENT") return { ok: false, kind: "unavailable", reason: "git is not installed" };
    return { ok: false, kind: "unavailable", reason: "not a git repository" };
  }
  const [commonRaw, topRaw] = out.split("\n").map((l) => l.trim());
  if (!commonRaw || !topRaw) return { ok: false, kind: "unavailable", reason: "not a git repository" };
  const commonDir = realpathSync(resolve(cwd, commonRaw));
  const toplevel = realpathSync(resolve(cwd, topRaw));
  const repoKey = createHash("sha256").update(commonDir).digest("hex").slice(0, 16);
  let remoteUrl: string | null = null;
  try {
    remoteUrl = deps.git(["remote", "get-url", cfg.remote], cwd).trim() || null;
  } catch { /* no such remote */ }
  const dir = join(deps.baseDir, repoKey);
  return { ok: true, repo: { repoKey, commonDir, toplevel, dir, dbPath: join(dir, "index.db"), hintPath: join(dir, "hint"), forge: resolveForge(remoteUrl, cfg) } };
}
