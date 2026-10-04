// Pluggable source resolvers (design §6b). A `SourceResolver` turns any source
// spec into a local directory; the indexer always operates on local dirs.
// Filesystem = trivial; npm/git/https = network + cache + TOFU trust.
// KB only reads markdown; it never executes source code.
//
// Source classification mirrors `packages/server/src/package-source-helpers.ts`
// (`parseSourceKind`/`computeIdentity`) — reimplemented here to keep this
// publishable package self-contained (no kb→server dependency).

import { execFileSync } from "node:child_process"; // ban:child_process-ok (kb package is self-contained; owns git clone/pull + tar/zip extract for remote resolvers, no pi-dashboard-shared dep)
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { type ArchiveKind, extractArchiveSafely } from "./archive-guard.js";
import type { SourceConfig } from "./config.js";
import { assertPublicHost, guardedFetch, type LookupAll } from "./net-guard.js";
import { isTrusted, recordTrust } from "./trust.js";

export type KbSourceKind = "filesystem" | "npm" | "git" | "https";

export interface ResolvedSource {
  id: string; // stored on chunks.root (the spec ref)
  dir: string; // absolute local directory to index
  priority: number;
  identity: string; // dedup identity
  revision?: string;
}

export interface ResolveCtx {
  cwd: string;
  cacheDir: string; // absolute, for remote clones/fetches
  refresh?: boolean; // --refresh: re-pull refreshable remote sources
  promptTrust?: (s: SourceConfig) => Promise<boolean>;
  /** Test seams only (change: harden-untrusted-content-ingestion). Never set in production. */
  testHooks?: {
    /** Replaces `guardedFetch` for the https resolver. */
    fetch?: (url: string) => Promise<Buffer>;
    /** Replaces the `git` binary: receives argv, returns stdout. */
    git?: (args: string[]) => string;
    /** Replaces `dns.lookup` for the git host check. */
    lookup?: LookupAll;
    /** Replaces `renameSync` in the stage→dest swap. */
    rename?: (from: string, to: string) => void;
  };
}

export interface SourceResolver {
  kind: KbSourceKind;
  resolve(spec: SourceConfig, ctx: ResolveCtx): Promise<ResolvedSource>;
}

/** Classify a ref string (mirrors parseSourceKind). */
export function classifyRef(ref: string): KbSourceKind {
  if (ref.startsWith("npm:")) return "npm";
  if (ref.startsWith("git:") || ref.startsWith("git@")) return "git";
  if (/^(https?|ssh):\/\//.test(ref)) return "https";
  return "filesystem";
}

/** Bare npm package name from a ref (`npm:@scope/pkg@1.2.3` → `@scope/pkg`). */
function npmBareName(ref: string): string {
  const rest = ref.startsWith("npm:") ? ref.slice(4) : ref;
  if (rest.startsWith("@")) {
    const at = rest.indexOf("@", 1);
    return at >= 0 ? rest.slice(0, at) : rest;
  }
  const at = rest.indexOf("@");
  return at >= 0 ? rest.slice(0, at) : rest;
}

/** Dedup identity (mirrors computeIdentity). cwd resolves relative paths. */
export function sourceIdentity(spec: SourceConfig, cwd = "."): string {
  const ref = spec.ref;
  const k = spec.kind ?? classifyRef(ref);
  if (k === "npm") return `npm:${npmBareName(ref)}`;
  if (k === "git" || k === "https") {
    const lastAt = ref.lastIndexOf("@");
    if (lastAt > 0) {
      const tail = ref.slice(lastAt + 1);
      if (!tail.includes(":") && !tail.includes("/")) return ref.slice(0, lastAt);
    }
    return ref;
  }
  return isAbsolute(ref) ? ref : resolve(cwd, ref);
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
export function cacheKey(spec: SourceConfig): string {
  return shortHash(`${spec.kind ?? classifyRef(spec.ref)}:${spec.ref}:${spec.pin ?? ""}`);
}

async function ensureTrusted(spec: SourceConfig, ctx: ResolveCtx): Promise<void> {
  if (isTrusted(spec)) return;
  const prompt = ctx.promptTrust ?? (async () => false);
  const ok = await prompt(spec);
  if (!ok) throw new Error(`remote source ${spec.kind}:${spec.ref} not trusted — run interactively or pre-approve`);
  recordTrust(spec);
}

function isStale(spec: SourceConfig, markerPath: string): boolean {
  if (!existsSync(markerPath)) return true;
  const ttlMs = typeof spec.refresh === "object" ? spec.refresh.ttlMs : undefined;
  if (!ttlMs) return false;
  return Date.now() - Number(statSync(markerPath).mtimeMs) > ttlMs;
}

// --- filesystem ---

export const filesystemResolver: SourceResolver = {
  kind: "filesystem",
  async resolve(spec, ctx) {
    const base = isAbsolute(spec.ref) ? spec.ref : resolve(ctx.cwd, spec.ref);
    const dir = spec.subdir ? join(base, spec.subdir) : base;
    return { id: spec.ref, dir, priority: spec.priority ?? 0, identity: sourceIdentity(spec, ctx.cwd) };
  },
};

// --- npm ---

export const npmResolver: SourceResolver = {
  kind: "npm",
  async resolve(spec, ctx) {
    await ensureTrusted(spec, ctx);
    const bare = npmBareName(spec.ref);
    const candidates = [
      join(homedir(), ".pi", "agent", "npm", "node_modules", bare),
      join(ctx.cwd, ".pi", "npm", "node_modules", bare),
      join(ctx.cwd, "node_modules", bare),
    ];
    const pkgDir = candidates.find((p) => existsSync(p));
    if (!pkgDir) throw new Error(`npm source ${spec.ref} not found (looked in ${candidates.join(", ")}). Install it first.`);
    const dir = spec.subdir ? join(pkgDir, spec.subdir) : pkgDir;
    return { id: spec.ref, dir, priority: spec.priority ?? 0, identity: sourceIdentity(spec, ctx.cwd) };
  },
};

// --- git ---

function gitUrlOf(spec: SourceConfig): string {
  const ref = spec.ref.startsWith("git:") ? spec.ref.slice(4) : spec.ref;
  if (ref.startsWith("git@")) return ref;
  if (/^github\.com\//.test(ref)) return `https://${ref}`;
  if (!/^[a-z]+:\/\//.test(ref)) return `https://${ref}`;
  return ref;
}
function gitRefOf(spec: SourceConfig): string | undefined {
  if (spec.pin) return spec.pin;
  const ref = spec.ref;
  if (!ref.startsWith("git@")) {
    const lastAt = ref.lastIndexOf("@");
    if (lastAt > 0) {
      const tail = ref.slice(lastAt + 1);
      if (!tail.includes(":") && !tail.includes("/")) return tail;
    }
  }
  return undefined;
}

// Option-like refs/pins are passed positionally to fetch/checkout — reject `-` prefixes.
function assertSafeGitRef(label: string, v: string | undefined): void {
  if (v !== undefined && (v.startsWith("-") || /[\x00-\x1f]/.test(v))) throw new Error(`git ${label} ${JSON.stringify(v)} is not allowed (option-like)`);
}

interface GitTarget { scheme: "https" | "ssh"; host: string; port: string }

/** Allowlist https / ssh / scp-style git@host:path on the URL git actually receives. */
function parseGitTarget(url: string): GitTarget {
  const scp = /^git@([^:/]+):/.exec(url);
  if (scp) return { scheme: "ssh", host: scp[1], port: "" };
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`git source URL is not valid: ${url}`); }
  if (u.protocol !== "https:" && u.protocol !== "ssh:") {
    throw new Error(`git source scheme ${u.protocol}// is not allowed (only https, ssh, git@host:path)`);
  }
  return { scheme: u.protocol === "https:" ? "https" : "ssh", host: u.hostname, port: u.port };
}

let warnedOldGit = false;

export const gitResolver: SourceResolver = {
  kind: "git",
  async resolve(spec, ctx) {
    await ensureTrusted(spec, ctx);
    const hooks = ctx.testHooks ?? {};
    // execFile (argv array, no shell) — never interpolate url/ref/pin into a
    // shell string (command-injection-safe even with hostile refs).
    const git = hooks.git ?? ((args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    const rawRef = spec.ref.startsWith("git:") ? spec.ref.slice(4) : spec.ref;
    if (/^[a-z][a-z0-9+.-]*::/i.test(rawRef)) throw new Error(`git transport helper refs are not allowed: ${rawRef}`);
    const url = gitUrlOf(spec);
    const ref = gitRefOf(spec);
    assertSafeGitRef("pin", spec.pin);
    assertSafeGitRef("ref", ref);
    const target = parseGitTarget(url);
    const addrs = await assertPublicHost(target.host, { lookup: hooks.lookup });

    // Hardening as GLOBAL options before the subcommand (`git clone -c` would only
    // write the new repo's config). Pin curl to the address we just checked (git >= 2.37).
    const hardening = [
      "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always",
      "-c", "http.followRedirects=false", "-c", "submodule.recurse=false", "-c", "fetch.recurseSubmodules=false",
    ];
    if (target.scheme === "https" && !isIPLiteral(target.host)) {
      const m = /git version (\d+)\.(\d+)/.exec(git(["version"]));
      if (m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 37))) {
        const ip = addrs[0].family === 6 ? `[${addrs[0].address}]` : addrs[0].address;
        hardening.push("-c", `http.curloptResolve=${target.host}:${target.port || "443"}:${ip}`);
      } else if (!warnedOldGit) {
        warnedOldGit = true;
        console.warn("[kb] git < 2.37: http.curloptResolve unavailable — host is checked but not pinned");
      }
    }

    const cloneDir = join(ctx.cacheDir, cacheKey(spec));
    let hasGit = existsSync(join(cloneDir, ".git"));
    const shouldPull = ctx.refresh || spec.refresh === "on-index" || (!hasGit);
    if (hasGit && shouldPull) {
      // A poisoned/stale `origin` must never be contacted: re-clone from the checked URL.
      let origin = "";
      try { origin = git(["-C", cloneDir, "remote", "get-url", "origin"]).trim(); } catch { /* treat as mismatch */ }
      if (origin !== url) { rmSync(cloneDir, { recursive: true, force: true }); hasGit = false; }
    }
    if (!hasGit) {
      mkdirSync(ctx.cacheDir, { recursive: true });
      git([...hardening, "clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), "--", url, cloneDir]);
    } else if (shouldPull) {
      if (ref) {
        git([...hardening, "-C", cloneDir, "fetch", "--no-recurse-submodules", "--depth", "1", "origin", ref]);
        git([...hardening, "-C", cloneDir, "checkout", "--no-recurse-submodules", ref]);
      } else git([...hardening, "-C", cloneDir, "pull", "--no-recurse-submodules", "--ff-only"]);
    }
    const rev = git(["-C", cloneDir, "rev-parse", "--short", "HEAD"]).trim();
    const dir = spec.subdir ? join(cloneDir, spec.subdir) : cloneDir;
    return { id: spec.ref, dir, priority: spec.priority ?? 0, identity: sourceIdentity(spec, ctx.cwd), revision: rev };
  },
};

function isIPLiteral(host: string): boolean {
  return isIP(host.startsWith("[") ? host.slice(1, -1) : host) !== 0;
}

// --- https ---

/** Archive kind from the URL *path* (query strings must not defeat detection). */
function archiveKindOf(pathname: string): ArchiveKind | undefined {
  if (/\.zip$/i.test(pathname)) return "zip";
  if (/\.(tar\.gz|tgz|tar\.bz2)$/i.test(pathname)) return "tar";
  return undefined;
}

/** Plain-file name: `basename(pathname)`, sanitised, falling back to `index.md`. */
function plainFileName(pathname: string): string {
  let name = pathname.endsWith("/") ? "" : basename(pathname);
  try { name = decodeURIComponent(name); } catch { /* keep raw */ }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f\\/:]/g, "_");
  return name === "" || name === "." || name === ".." ? "index.md" : name;
}

/**
 * Lock-free, single-winner cache swap (review: concurrent refreshes).
 *
 * Every writer backs the previous cache up under a UNIQUE name
 * (`<dest>.old-<epochMs>-<uuid>`) and only ever deletes ITS OWN backup, so one
 * writer can never destroy another's rollback copy. Concurrent writers are
 * last-writer-wins: a loser errors out (rename onto a populated dest fails) but
 * `dest` always holds one writer's complete, valid content — never a mix, never
 * nothing. No lock, so no lock-ownership/stale-steal class of bugs.
 */
function swapInto(dest: string, fresh: string, rename: (a: string, b: string) => void): void {
  const backup = `${dest}.old-${Date.now()}-${randomUUID()}`;
  const hadDest = existsSync(dest);
  if (hadDest) rename(dest, backup);
  try {
    rename(fresh, dest);
  } catch (e) {
    if (hadDest) {
      try {
        rename(backup, dest);
      } catch {
        // dest was repopulated by a concurrent writer: it is valid, keep it; the backup ages out
      }
    }
    throw e;
  }
  if (hadDest) rmSync(backup, { recursive: true, force: true });
}

/** Backups older than this are crash debris, never a writer's in-flight rollback copy. */
const BACKUP_MAX_AGE_MS = 60 * 60_000;
const backupStamp = (name: string): number => Number(/\.old-(\d+)-/.exec(name)?.[1] ?? 0);

/**
 * Crash recovery: restore the newest backup when `dest` is gone (a crash between
 * the two swap renames), then prune only backups old enough to be debris.
 */
function recoverBackups(dest: string): void {
  const dir = dirname(dest);
  const prefix = `${basename(dest)}.old-`;
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.startsWith(prefix));
  } catch {
    return;
  }
  names.sort((x, y) => backupStamp(y) - backupStamp(x)); // newest first
  if (!existsSync(dest) && names.length) {
    try {
      renameSync(join(dir, names[0]), dest);
      names.shift();
    } catch {
      // a concurrent writer restored/populated dest first — fine
    }
  }
  for (const n of names) {
    if (Date.now() - backupStamp(n) > BACKUP_MAX_AGE_MS) rmSync(join(dir, n), { recursive: true, force: true });
  }
}

export const httpsResolver: SourceResolver = {
  kind: "https",
  async resolve(spec, ctx) {
    await ensureTrusted(spec, ctx);
    const hooks = ctx.testHooks ?? {};
    const dest = join(ctx.cacheDir, cacheKey(spec));
    const marker = join(dest, ".fetched");
    let url: URL;
    try { url = new URL(spec.ref); } catch { throw new Error(`invalid source URL: ${spec.ref}`); }
    if (url.protocol !== "https:") throw new Error(`only https:// sources are allowed (got ${url.protocol}//): ${spec.ref}`);

    // Crash recovery from a previous interrupted swap.
    recoverBackups(dest);

    const shouldFetch = ctx.refresh || spec.refresh === "on-index" || isStale(spec, marker);
    if (shouldFetch) {
      mkdirSync(ctx.cacheDir, { recursive: true });
      const stage = mkdtempSync(join(ctx.cacheDir, ".stage-"));
      try {
        const out = join(stage, "out");
        mkdirSync(out);
        const body = await (hooks.fetch ?? ((u: string) => guardedFetch(u)))(spec.ref);
        const kind = archiveKindOf(url.pathname);
        if (kind) {
          const archive = join(stage, kind === "zip" ? "archive.zip" : "archive.tar");
          writeFileSync(archive, body);
          extractArchiveSafely(kind, archive, out);
        } else {
          writeFileSync(join(out, plainFileName(url.pathname)), body);
        }
        writeFileSync(join(out, ".fetched"), String(Date.now()));
        swapInto(dest, out, hooks.rename ?? renameSync);
      } finally {
        rmSync(stage, { recursive: true, force: true });
      }
    }
    return { id: spec.ref, dir: dest, priority: spec.priority ?? 0, identity: sourceIdentity(spec, ctx.cwd) };
  },
};

const RESOLVERS: Record<KbSourceKind, SourceResolver> = {
  filesystem: filesystemResolver,
  npm: npmResolver,
  git: gitResolver,
  https: httpsResolver,
};

export function resolverFor(kind: KbSourceKind): SourceResolver {
  return RESOLVERS[kind];
}

/** Resolve all configured sources to local dirs. Filesystem sources are sync
 *  and need no trust; remote sources prompt TOFU and may hit the network. */
export async function resolveAll(specs: SourceConfig[], ctx: ResolveCtx): Promise<ResolvedSource[]> {
  const out: ResolvedSource[] = [];
  for (const spec of specs) {
    const kind = (spec.kind ?? classifyRef(spec.ref)) as KbSourceKind;
    out.push(await resolverFor(kind).resolve(spec, ctx));
  }
  return out;
}
