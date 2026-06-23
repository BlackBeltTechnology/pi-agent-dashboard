// Pluggable source resolvers (design §6b). A `SourceResolver` turns any source
// spec into a local directory; the indexer always operates on local dirs.
// Filesystem = trivial; npm/git/https = network + cache + TOFU trust.
// KB only reads markdown; it never executes source code.
//
// Source classification mirrors `packages/server/src/package-source-helpers.ts`
// (`parseSourceKind`/`computeIdentity`) — reimplemented here to keep this
// publishable package self-contained (no kb→server dependency).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process"; // ban:child_process-ok (kb package is self-contained; owns git clone/pull + tar/zip extract for remote resolvers, no pi-dashboard-shared dep)
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { SourceConfig } from "./config.js";
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
function cacheKey(spec: SourceConfig): string {
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

export const gitResolver: SourceResolver = {
  kind: "git",
  async resolve(spec, ctx) {
    await ensureTrusted(spec, ctx);
    const cloneDir = join(ctx.cacheDir, cacheKey(spec));
    const url = gitUrlOf(spec);
    const ref = gitRefOf(spec);
    const hasGit = existsSync(join(cloneDir, ".git"));
    const shouldPull = ctx.refresh || spec.refresh === "on-index" || (!hasGit);
    // execFileSync (argv array, no shell) — never interpolate url/ref/pin into a
    // shell string (command-injection-safe even with hostile refs).
    const git = (args: string[]) => execFileSync("git", args, { stdio: "pipe" });
    if (!hasGit) {
      mkdirSync(ctx.cacheDir, { recursive: true });
      git(["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), "--", url, cloneDir]);
    } else if (shouldPull) {
      if (ref) { git(["-C", cloneDir, "fetch", "--depth", "1", "origin", ref]); git(["-C", cloneDir, "checkout", ref]); }
      else git(["-C", cloneDir, "pull", "--ff-only"]);
    }
    const rev = execFileSync("git", ["-C", cloneDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dir = spec.subdir ? join(cloneDir, spec.subdir) : cloneDir;
    return { id: spec.ref, dir, priority: spec.priority ?? 0, identity: sourceIdentity(spec, ctx.cwd), revision: rev };
  },
};

// --- https ---

export const httpsResolver: SourceResolver = {
  kind: "https",
  async resolve(spec, ctx) {
    await ensureTrusted(spec, ctx);
    const dest = join(ctx.cacheDir, cacheKey(spec));
    const url = spec.ref;
    const marker = join(dest, ".fetched");
    const isArchive = /\.(tar\.gz|tgz|tar\.bz2|zip)$/.test(url);
    const shouldFetch = ctx.refresh || spec.refresh === "on-index" || isStale(spec, marker);
    if (shouldFetch) {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      mkdirSync(dest, { recursive: true });
      if (isArchive) {
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const archivePath = join(dest, "archive" + (url.endsWith(".zip") ? ".zip" : ".tar.gz"));
        writeFileSync(archivePath, buf);
        if (url.endsWith(".zip")) execFileSync("unzip", ["-o", archivePath, "-d", dest], { stdio: "pipe" });
        else execFileSync("tar", ["xzf", archivePath, "-C", dest], { stdio: "pipe" });
      } else {
        const text = await (await fetch(url)).text();
        writeFileSync(join(dest, url.split("/").pop() || "index.md"), text);
      }
      writeFileSync(marker, String(Date.now()));
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
