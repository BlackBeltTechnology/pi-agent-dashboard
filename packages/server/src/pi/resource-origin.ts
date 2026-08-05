/**
 * Resource origin classification + the narrow pi-semantics mirrors the
 * project-scope write path needs.
 *
 * A resource's *origin* decides which pi-standard settings form disables it.
 * Classification is by longest-prefix match of the resolved absolute path
 * against the candidate base directories — never by `metadata.scope` /
 * `metadata.source` / `metadata.baseDir` of the resource itself, because a
 * project-scope disable of a global resource mutates exactly those fields
 * (pi then reports `scope: project`, `source: local`, `baseDir: undefined`).
 * A metadata-keyed classifier could not recognise, on re-enable, the resource
 * it had itself re-declared. Longest-prefix is also order-independent, which
 * matters when `cwd === $HOME` and `<cwd>/.pi` is a strict ancestor of the
 * global base `~/.pi/agent`.
 *
 * Three pi internals are mirrored here at the narrowest possible surface,
 * because pi does not export them (see design D2/D6/D9):
 *   - `normalizeExactPattern` / the exact-spelling set `matchesAnyExactPattern`
 *     accepts, for the equivalence-class strip.
 *   - `getPackageIdentity`'s npm/git/local normalisation, for matching an
 *     existing `packages` entry spelled differently for the same package.
 * Tests assert observed activation rather than pattern text, so a semantic
 * drift in pi fails loudly. See `bump-pi-version`.
 *
 * See change: project-scope-disable-global-resources.
 */
import * as path from "node:path";
import type { ResolvedPaths } from "./pi-resource-activation.js";

/** Which pi-standard write form applies to a resource. */
export type OriginKind = "project-loose" | "agents-loose" | "global-loose" | "package";

export interface ResourceOrigin {
  kind: OriginKind;
  /** Directory the written pattern is expressed relative to. */
  baseDir: string;
  /** Declared package source string; only set for `kind: "package"`. */
  packageSource?: string;
}

const RESOURCE_KEYS = ["extensions", "skills", "prompts", "themes"] as const;

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** pi's `normalizeExactPattern`: strip a leading `./`, then POSIX-ify. */
export function normalizeExactPattern(pattern: string): string {
  const normalized =
    pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
  return toPosix(normalized);
}

/** Strip pi's `!`/`+`/`-` precedence prefix from a settings-array entry. */
export function stripPrefix(entry: string): string {
  return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-")
    ? entry.slice(1)
    : entry;
}

/** True when `child` is strictly inside `parent`. */
function isUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export interface Candidate extends ResourceOrigin {}

/**
 * Candidate base directories for classification: every package root and every
 * `.agents` base directory pi reported, plus `<cwd>/.pi` and the global bases.
 */
export function collectOriginCandidates(args: {
  cwd: string;
  agentDir: string;
  homeDir: string;
  resolved: ResolvedPaths;
}): Candidate[] {
  const { cwd, agentDir, homeDir, resolved } = args;
  const homeAgents = path.join(homeDir, ".agents");
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const key of RESOURCE_KEYS) {
    for (const r of resolved[key] ?? []) {
      const baseDir = r.metadata?.baseDir;
      if (!baseDir) continue;
      if (r.metadata.origin === "package") {
        const dedupe = `package\u0000${baseDir}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ kind: "package", baseDir, packageSource: r.metadata.source });
        continue;
      }
      // A `.agents` base dir pi reported. The user-level `~/.agents` is a
      // global base, not a project one, and is added below.
      if (path.basename(baseDir) === ".agents" && path.resolve(baseDir) !== path.resolve(homeAgents)) {
        const dedupe = `agents\u0000${baseDir}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push({ kind: "agents-loose", baseDir });
      }
    }
  }
  out.push({ kind: "project-loose", baseDir: path.join(cwd, ".pi") });
  out.push({ kind: "global-loose", baseDir: agentDir });
  out.push({ kind: "global-loose", baseDir: homeAgents });
  return out;
}

/**
 * Classify a resource by longest-prefix path match. Returns `null` when the
 * path lies under no known base directory.
 */
export function classifyResourceOrigin(args: {
  filePath: string;
  cwd: string;
  agentDir: string;
  homeDir: string;
  resolved: ResolvedPaths;
}): ResourceOrigin | null {
  return classifyFrom(args.filePath, collectOriginCandidates(args));
}

/** `classifyResourceOrigin` against a candidate list computed once. */
export function classifyFrom(filePath: string, candidates: Candidate[]): ResourceOrigin | null {
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (!isUnder(filePath, c.baseDir)) continue;
    if (!best || c.baseDir.length > best.baseDir.length) best = c;
  }
  return best;
}

/**
 * Every spelling of `filePath` that pi's `matchesAnyExactPattern` accepts when
 * evaluating an array against `baseDir`: the relative and absolute forms, plus
 * the parent-directory forms for a `SKILL.md`.
 */
export function exactSpellings(filePath: string, baseDir: string): string[] {
  const out = [toPosix(path.relative(baseDir, filePath)), toPosix(filePath)];
  if (path.basename(filePath) === "SKILL.md") {
    const parent = path.dirname(filePath);
    out.push(toPosix(path.relative(baseDir, parent)), toPosix(parent));
  }
  return out;
}

function npmIdentity(spec: string): string {
  const trimmed = spec.trim();
  const at = trimmed.lastIndexOf("@");
  return `npm:${at > 0 ? trimmed.slice(0, at) : trimmed}`;
}

/**
 * `git:<host>/<path>` for any git spelling, unifying SSH and HTTPS. Returns
 * `null` when the source is not a git source.
 */
function gitIdentity(source: string): string | null {
  let s = source.trim();
  const hadPrefix = s.startsWith("git:") && !s.startsWith("git://");
  if (hadPrefix) s = s.slice(4).trim();
  if (!hadPrefix && !/^(https?|ssh|git):\/\//i.test(s)) return null;
  s = s.replace(/#.*$/, "");
  s = s.replace(/^(https?|ssh|git):\/\//i, "");
  s = s.replace(/^[^@/]+@/, "");
  s = s.replace(/^([^/:]+):/, "$1/");
  s = s.replace(/\.git$/, "").replace(/\/+$/, "");
  const slash = s.indexOf("/");
  if (slash === -1) return null;
  return `git:${s.slice(0, slash).toLowerCase()}/${s.slice(slash + 1)}`;
}

/**
 * pi's `getPackageIdentity`, narrowed: npm reduced to its name without version,
 * git to host/path across spellings, local to its resolved path.
 */
export function packageIdentity(source: string, baseDir: string): string {
  const s = source.trim();
  if (s.startsWith("npm:")) return npmIdentity(s.slice("npm:".length));
  const git = gitIdentity(s);
  if (git) return git;
  return `local:${path.resolve(baseDir, s)}`;
}
