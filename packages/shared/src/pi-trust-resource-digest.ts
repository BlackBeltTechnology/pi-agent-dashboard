/**
 * Content proof for REMOTE live trust answers: a salted digest of exactly what
 * pi's project-trust gate protects for a cwd.
 *
 * pi decides "does this folder need trust" from `<cwd>/.pi/{settings.json,
 * mcp.json, extensions, skills, prompts, themes, SYSTEM.md, APPEND_SYSTEM.md}`
 * plus `<d>/.agents/skills` for the cwd and every ancestor (except the user's own
 * `~/.agents/skills`). `trustResourceManifest` lists every entry under that set
 * (files by content hash, directories by name) and the answer binds it to the
 * cwd key with an HMAC over a fresh salt. Two sides trust only on equality of two
 * computed digests, so a different folder at the same path (or a copy that
 * differs in `.pi/mcp.json`) never inherits trust.
 *
 * Fail-closed → `null`: empty set, any symlink / non-regular entry, a read
 * failure, a cap (1,000 entries / 16 MiB), unparseable or unrecognised
 * `.pi/settings.json` references, or references to code outside the set.
 * Async (`fs/promises`) with an AbortSignal checked after every awaited read, so
 * the bridge's single deadline can stop the walk.
 *
 * Node-only. See change: mirror-dashboard-trust-live-remote (D5).
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

/**
 * pi does not export its own list (`TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`),
 * so ours is a literal, pinned to pi's by a golden test.
 */
export const TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES: readonly string[] = [
  "settings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
];

/** `.pi` subtrees a settings reference may legitimately point into (all hashed recursively). */
const CODE_SUBTREES = ["extensions", "skills", "prompts", "themes"] as const;

export const TRUST_RESOURCE_MAX_ENTRIES = 1000;
export const TRUST_RESOURCE_MAX_BYTES = 16 * 1024 * 1024;

const DIGEST_DOMAIN = "pi-trust-live/v1";

class FailClosed extends Error {}

interface Walk {
  entries: Array<{ label: string; line: string }>;
  bytes: number;
  signal?: AbortSignal;
}

function checkAbort(w: Walk): void {
  if (w.signal?.aborted) throw new FailClosed("aborted");
}

function addEntry(w: Walk, label: string, line: string): void {
  if (w.entries.length >= TRUST_RESOURCE_MAX_ENTRIES) throw new FailClosed("too many entries");
  w.entries.push({ label, line });
}

async function lstatOrNull(p: string, w: Walk): Promise<import("node:fs").Stats | null> {
  try {
    const st = await fsp.lstat(p);
    checkAbort(w);
    return st;
  } catch (err) {
    checkAbort(w);
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT" || (err as NodeJS.ErrnoException)?.code === "ENOTDIR") return null;
    throw new FailClosed("stat failed");
  }
}

/** Add `abs` (labelled `label`) and, for a directory, everything below it. */
async function addTree(w: Walk, abs: string, label: string): Promise<boolean> {
  const st = await lstatOrNull(abs, w);
  if (!st) return false;
  if (st.isSymbolicLink()) throw new FailClosed("symlink");
  if (st.isDirectory()) {
    addEntry(w, label, `${label}\0d`);
    let names: string[];
    try {
      names = await fsp.readdir(abs);
    } catch {
      throw new FailClosed("readdir failed");
    }
    checkAbort(w);
    for (const name of names) await addTree(w, path.join(abs, name), `${label}/${name}`);
    return true;
  }
  if (!st.isFile()) throw new FailClosed("special file");
  if (w.bytes + st.size > TRUST_RESOURCE_MAX_BYTES) throw new FailClosed("too large");
  w.bytes += st.size;
  let buf: Buffer;
  try {
    buf = await fsp.readFile(abs, w.signal ? { signal: w.signal } : undefined);
  } catch {
    throw new FailClosed("read failed");
  }
  checkAbort(w);
  addEntry(w, label, `${label}\0f\0${createHash("sha256").update(buf).digest("hex")}`);
  return true;
}

function withinOrEqual(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * `.pi/settings.json` may point pi at code. Every reference must stay inside the
 * hashed subtrees; `packages` (fetched by pi) and any shape we do not recognise
 * fail closed.
 */
async function checkSettingsRefs(w: Walk, piDir: string): Promise<void> {
  const file = path.join(piDir, "settings.json");
  const st = await lstatOrNull(file, w);
  if (!st) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    throw new FailClosed("settings unparseable");
  }
  checkAbort(w);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new FailClosed("settings shape");
  const obj = parsed as Record<string, unknown>;
  if ("packages" in obj) {
    if (!Array.isArray(obj.packages) || obj.packages.length > 0) throw new FailClosed("packages referenced");
  }
  const roots = CODE_SUBTREES.map((n) => path.join(piDir, n));
  for (const key of CODE_SUBTREES) {
    if (!(key in obj)) continue;
    const list = obj[key];
    if (!Array.isArray(list)) throw new FailClosed("reference shape");
    for (const item of list) {
      if (typeof item !== "string") throw new FailClosed("reference shape");
      let ref = item;
      if (ref.startsWith("!") || ref.startsWith("+") || ref.startsWith("-")) ref = ref.slice(1);
      const glob = ref.search(/[*?[{]/);
      if (glob >= 0) ref = ref.slice(0, ref.lastIndexOf("/", glob) + 1) || ".";
      const resolved = path.resolve(piDir, ref);
      if (!roots.some((r) => withinOrEqual(resolved, r))) throw new FailClosed("reference outside set");
    }
  }
}

function compareCodePoints(a: string, b: string): number {
  const ai = Array.from(a);
  const bi = Array.from(b);
  const n = Math.min(ai.length, bi.length);
  for (let i = 0; i < n; i += 1) {
    const x = ai[i].codePointAt(0) as number;
    const y = bi[i].codePointAt(0) as number;
    if (x !== y) return x - y;
  }
  return ai.length - bi.length;
}

async function realOrSelf(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The manifest of pi's trust-requiring resources for `cwd` (a canonical key), or
 * `null` when the set is empty or cannot be bound. `home` is this side's own home
 * (its `.agents/skills` is the user's, excluded).
 */
export async function trustResourceManifest(
  cwd: string,
  opts: { home: string; signal?: AbortSignal },
): Promise<string | null> {
  const w: Walk = { entries: [], bytes: 0, signal: opts.signal };
  try {
    checkAbort(w);
    const userSkills = path.join(await realOrSelf(opts.home), ".agents", "skills");
    checkAbort(w);

    const piDir = path.join(cwd, ".pi");
    const piStat = await lstatOrNull(piDir, w);
    if (piStat) {
      if (piStat.isSymbolicLink()) throw new FailClosed("symlink");
      if (piStat.isDirectory()) {
        await checkSettingsRefs(w, piDir);
        for (const name of TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES) {
          await addTree(w, path.join(piDir, name), `c/${name}`);
        }
      }
    }

    let k = 0;
    for (let dir = cwd; ; k += 1) {
      const agents = path.join(dir, ".agents");
      const agentsStat = await lstatOrNull(agents, w);
      if (agentsStat?.isSymbolicLink()) throw new FailClosed("symlink");
      const skills = path.join(agents, "skills");
      if (skills !== userSkills && agentsStat) await addTree(w, skills, `a${k}`);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    if (w.entries.length === 0) return null;
    w.entries.sort((a, b) => compareCodePoints(a.label, b.label));
    return w.entries.map((e) => e.line).join("\n");
  } catch (err) {
    if (err instanceof FailClosed) return null;
    return null;
  }
}

/** 16 random bytes, hex. Fresh per answer. */
export function newTrustSalt(): string {
  return randomBytes(16).toString("hex");
}

/** `HMAC-SHA256(salt, "pi-trust-live/v1\n" + cwdKey + "\n" + manifest)`, hex. */
export function trustResourceDigest(salt: string, cwdKey: string, manifest: string): string {
  return createHmac("sha256", salt).update(`${DIGEST_DOMAIN}\n${cwdKey}\n${manifest}`).digest("hex");
}
