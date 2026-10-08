/**
 * Team data layout + path safety (D2). All paths are built from validated
 * slugs + a hashed user key and asserted to lie under TEAM_HOME after
 * canonicalising the longest existing ancestor.
 * See change: add-team-plugin.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TeamError, WORKSPACE_TARGET } from "./types.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isSlug(v: unknown): v is string {
  return typeof v === "string" && SLUG_RE.test(v);
}

/** `uk = hex(sha256(iss + "\0" + sub)).slice(0, 32)`. */
export function userKey(iss: string, sub: string): string {
  return createHash("sha256").update(`${iss}\0${sub}`).digest("hex").slice(0, 32);
}

export const LOCAL_USER_KEY = "local";

/** A target id is a project slug or `_ws`. */
export function isTargetId(v: unknown): v is string {
  return v === WORKSPACE_TARGET || isSlug(v);
}

/** Persona key `<scope>:<slug>` → parts, else null. */
export function parsePersonaKey(key: unknown): { scope: "shared" | "private"; slug: string } | null {
  if (typeof key !== "string") return null;
  const i = key.indexOf(":");
  if (i < 0) return null;
  const scope = key.slice(0, i);
  const slug = key.slice(i + 1);
  if ((scope !== "shared" && scope !== "private") || !isSlug(slug)) return null;
  return { scope, slug };
}

/** Folder-safe form of a persona key: `<scope>-<slug>`. */
export function personaDirName(key: string): string {
  const p = parsePersonaKey(key);
  if (!p) throw new TeamError(400, "invalid_persona_key");
  return `${p.scope}-${p.slug}`;
}

/** Longest-existing-ancestor realpath (symlinks resolved; absent tail kept lexically). */
export function canonicalize(p: string): string {
  const abs = path.resolve(p);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(head);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

/** True when `child` equals or lies inside `parent` (both canonical). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveTeamHome(configured: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const pick = env.PI_TEAM_HOME?.trim() || configured?.trim();
  const base = pick
    ? pick.startsWith("~/")
      ? path.join(os.homedir(), pick.slice(2))
      : pick
    : path.join(os.homedir(), ".pi", "dashboard", "team");
  return path.resolve(base);
}

export class TeamPaths {
  readonly home: string;
  constructor(home: string) {
    this.home = canonicalize(home);
  }

  /** Assert `p` canonicalises under TEAM_HOME. */
  confine(p: string): string {
    const canon = canonicalize(p);
    if (!isInside(this.home, canon)) throw new TeamError(500, "path_escape");
    return p;
  }

  private under(...parts: string[]): string {
    return this.confine(path.join(this.home, ...parts));
  }

  sharedPersonasDir(): string {
    return this.under("personas");
  }
  userDir(uk: string): string {
    if (uk !== LOCAL_USER_KEY && !/^[0-9a-f]{32}$/.test(uk)) throw new TeamError(500, "invalid_user_key");
    return this.under("users", uk);
  }
  privatePersonasDir(uk: string): string {
    return this.under("users", this.ukSeg(uk), "personas");
  }
  conversationsDir(uk: string, t: string, personaKey: string): string {
    if (!isTargetId(t)) throw new TeamError(400, "invalid_target");
    return this.under("users", this.ukSeg(uk), "conversations", t, personaDirName(personaKey));
  }
  conversationsRoot(uk: string): string {
    return this.under("users", this.ukSeg(uk), "conversations");
  }
  workspaceDir(uk: string): string {
    return this.under("users", this.ukSeg(uk), "workspace");
  }
  runtimeDir(uk: string, personaKey: string): string {
    return this.under("users", this.ukSeg(uk), "runtime", personaDirName(personaKey));
  }
  projectsFile(): string {
    return this.under("projects.json");
  }
  usersFile(): string {
    return this.under("users.json");
  }
  private ukSeg(uk: string): string {
    if (uk !== LOCAL_USER_KEY && !/^[0-9a-f]{32}$/.test(uk)) throw new TeamError(500, "invalid_user_key");
    return uk;
  }
}

/** Atomic JSON write: tmp + rename; the tmp file is removed when the rename fails. */
export interface FsOps {
  writeFile(p: string, data: string): void;
  rename(a: string, b: string): void;
  rm(p: string): void;
  mkdir(p: string): void;
}

export const realFs: FsOps = {
  writeFile: (p, d) => fs.writeFileSync(p, d, { mode: 0o600 }),
  rename: (a, b) => fs.renameSync(a, b),
  rm: (p) => fs.rmSync(p, { force: true }),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true, mode: 0o700 }),
};

export function atomicWriteJson(file: string, value: unknown, ops: FsOps = realFs): void {
  ops.mkdir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    ops.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
    ops.rename(tmp, file);
  } catch (err) {
    try {
      ops.rm(tmp);
    } catch {
      /* best effort */
    }
    throw err;
  }
}
