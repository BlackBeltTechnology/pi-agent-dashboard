/**
 * Project registry (D13/D17): admin-config projects (read-only) + folders
 * enabled from the dashboard (`TEAM_HOME/projects.json`), path validation,
 * allowlists and folder → project matching. See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson, canonicalize, type FsOps, isInside, isSlug, realFs, type TeamPaths } from "./paths.js";
import { cpLength } from "./persona.js";
import { type Caller, type Mode, type Project, type ProjectConfigEntry, type TeamConfig, TeamError } from "./types.js";

const FOLDER_PROJECTS_MAX = 200;

interface ProjectLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

interface StoredFolderProject {
  id: string;
  name: string;
  path: string;
  users: "*" | { iss: string; sub: string }[];
  contextFiles: boolean;
  createdBy: string;
  createdAt: string;
}

interface FolderFile {
  schemaVersion: 1;
  projects: StoredFolderProject[];
}

export type PathCheck = { ok: true; real: string } | { ok: false; reason: string };

export interface ProjectDeps {
  paths: TeamPaths;
  config: () => TeamConfig;
  logger: ProjectLogger;
  /** pi agent dir (`~/.pi`); a project may not contain or lie inside it. */
  piDir: string;
  now?: () => Date;
  ops?: FsOps;
}

type UsersSpec = "*" | { iss: string; sub: string }[];

function parseUsers(v: unknown): UsersSpec | null {
  if (v === "*") return "*";
  if (Array.isArray(v) && v.every((u) => u && typeof u.iss === "string" && typeof u.sub === "string")) {
    return v.map((u: { iss: string; sub: string }) => ({ iss: u.iss, sub: u.sub }));
  }
  return null;
}

function slugify(base: string): string {
  const s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return isSlug(s) ? s : "project";
}

export class ProjectRegistry {
  private readonly ops: FsOps;
  private accepted = new Set<string>();
  private acceptedFor = "";
  private readonly warned = new Set<string>();

  constructor(private readonly deps: ProjectDeps) {
    this.ops = deps.ops ?? realFs;
    this.activate();
  }

  /** Validate a candidate project root (D13). */
  validatePath(p: unknown): PathCheck {
    if (typeof p !== "string" || p.length === 0 || p.includes("\0")) return { ok: false, reason: "not_absolute" };
    if (!path.isAbsolute(p)) return { ok: false, reason: "not_absolute" };
    let real: string;
    try {
      real = fs.realpathSync(p);
    } catch {
      return { ok: false, reason: "missing" };
    }
    try {
      if (!fs.statSync(real).isDirectory()) return { ok: false, reason: "not_directory" };
    } catch {
      return { ok: false, reason: "missing" };
    }
    for (const forbidden of [this.deps.paths.home, canonicalize(this.deps.piDir)]) {
      if (isInside(forbidden, real) || isInside(real, forbidden)) return { ok: false, reason: "overlaps_protected_dir" };
    }
    return { ok: true, real };
  }

  private warnOnce(id: string, reason: string): void {
    const k = `${id}:${reason}`;
    if (this.warned.has(k)) return;
    this.warned.add(k);
    this.deps.logger.warn(`team.project_invalid projectId=${id} reason=${reason}`);
  }

  private configEntries(): Record<string, ProjectConfigEntry> {
    return this.deps.config().projects ?? {};
  }

  /** Re-derive the accepted set when the config changed (activation semantics). */
  private activate(): void {
    const entries = this.configEntries();
    const sig = JSON.stringify(entries);
    if (sig === this.acceptedFor) return;
    this.acceptedFor = sig;
    this.accepted = new Set();
    for (const [id, e] of Object.entries(entries)) {
      if (!isSlug(id)) {
        this.warnOnce(id, "invalid_id");
        continue;
      }
      if (!e || typeof e.name !== "string" || cpLength(e.name) < 1 || cpLength(e.name) > 60 || parseUsers(e.users) === null) {
        this.warnOnce(id, "invalid_entry");
        continue;
      }
      const check = this.validatePath(e.path);
      if (!check.ok) {
        this.warnOnce(id, check.reason);
        continue;
      }
      this.accepted.add(id);
    }
  }

  private readFolderFile(): StoredFolderProject[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.deps.paths.projectsFile(), "utf8")) as FolderFile;
      return raw?.schemaVersion === 1 && Array.isArray(raw.projects) ? raw.projects : [];
    } catch {
      return [];
    }
  }

  private writeFolderFile(projects: StoredFolderProject[]): void {
    atomicWriteJson(this.deps.paths.projectsFile(), { schemaVersion: 1, projects } satisfies FolderFile, this.ops);
  }

  private toProject(
    id: string,
    name: string,
    p: string,
    users: UsersSpec,
    contextFiles: boolean,
    source: Project["source"],
  ): Project {
    const check = this.validatePath(p);
    if (!check.ok && source === "config") this.warnOnce(id, check.reason);
    return { id, name, path: check.ok ? check.real : undefined, users, contextFiles, source, available: check.ok };
  }

  /** Every project (config wins over a folder-enabled one on id or path). */
  all(): Project[] {
    this.activate();
    const out: Project[] = [];
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [id, e] of Object.entries(this.configEntries())) {
      if (!this.accepted.has(id)) continue;
      const users = parseUsers(e.users) ?? [];
      const proj = this.toProject(id, e.name, e.path, users, e.contextFiles === true, "config");
      out.push(proj);
      ids.add(id);
      const c = this.validatePath(e.path);
      if (c.ok) paths.add(c.real);
    }
    for (const f of this.readFolderFile()) {
      const c = this.validatePath(f.path);
      if (ids.has(f.id) || (c.ok && paths.has(c.real))) {
        this.warnOnce(f.id, "shadowed_by_config");
        continue;
      }
      out.push(this.toProject(f.id, f.name, f.path, f.users, f.contextFiles === true, "folder"));
      ids.add(f.id);
    }
    return out;
  }

  get(id: string): Project | undefined {
    return this.all().find((p) => p.id === id);
  }

  canUse(project: Project, caller: Caller, mode: Mode): boolean {
    if (mode === "single") return true;
    if (project.users === "*") return true;
    return project.users.some((u) => u.iss === caller.iss && u.sub === caller.sub);
  }

  /** Projects the caller may use (listed even when unavailable). */
  usableBy(caller: Caller, mode: Mode): Project[] {
    return this.all().filter((p) => this.canUse(p, caller, mode));
  }

  /** `realpath(cwd)` equal to a usable project, else the nearest containing one (D17). */
  resolveFolder(caller: Caller, mode: Mode, cwd: string): Project | null {
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
    let real: string;
    try {
      real = fs.realpathSync(cwd);
    } catch {
      return null;
    }
    let best: Project | null = null;
    for (const p of this.usableBy(caller, mode)) {
      if (!p.available || !p.path || !isInside(p.path, real)) continue;
      if (!best || (p.path?.length ?? 0) > (best.path?.length ?? 0)) best = p;
    }
    return best;
  }

  /** May the caller enable this folder as a project? */
  enableable(caller: Caller, cwd: string): boolean {
    if (!caller.admin) return false;
    const check = this.validatePath(cwd);
    if (!check.ok) return false;
    return !this.all().some((p) => p.path === check.real);
  }

  // ── folder-enabled writes (D17) ────────────────────────────────────────────

  enable(
    caller: Caller,
    body: { path?: unknown; name?: unknown; users?: unknown; contextFiles?: unknown },
  ): { id: string } {
    if (!caller.admin) throw new TeamError(403, "admin_required");
    const check = this.validatePath(body.path);
    if (!check.ok) throw new TeamError(400, "invalid_project", { reason: check.reason });
    if (this.all().some((p) => p.path === check.real)) throw new TeamError(409, "project_exists");
    const stored = this.readFolderFile();
    if (stored.length >= FOLDER_PROJECTS_MAX) throw new TeamError(409, "project_limit");
    const base = path.basename(check.real);
    const name = body.name === undefined ? base : body.name;
    if (typeof name !== "string" || cpLength(name) < 1 || cpLength(name) > 60) throw new TeamError(400, "invalid_project", { reason: "name" });
    const users = body.users === undefined ? "*" : parseUsers(body.users);
    if (users === null || (Array.isArray(users) && users.length === 0)) throw new TeamError(400, "invalid_project", { reason: "users" });
    const taken = new Set([...Object.keys(this.configEntries()), ...stored.map((s) => s.id)]);
    let id = slugify(base);
    for (let n = 2; taken.has(id); n++) id = `${slugify(base).slice(0, 36)}-${n}`;
    stored.push({
      id,
      name,
      path: check.real,
      users,
      contextFiles: body.contextFiles === true,
      createdBy: caller.uk,
      createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
    });
    this.writeFolderFile(stored);
    return { id };
  }

  private requireFolderProject(id: string): StoredFolderProject[] {
    if (Object.hasOwn(this.configEntries(), id) && this.accepted.has(id)) throw new TeamError(409, "project_readonly");
    const stored = this.readFolderFile();
    if (!stored.some((s) => s.id === id)) throw new TeamError(404, "project_not_found");
    return stored;
  }

  patch(caller: Caller, id: string, body: { name?: unknown; users?: unknown; contextFiles?: unknown }): void {
    if (!caller.admin) throw new TeamError(403, "admin_required");
    const stored = this.requireFolderProject(id);
    const cur = stored.find((s) => s.id === id) as StoredFolderProject;
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || cpLength(body.name) < 1 || cpLength(body.name) > 60) throw new TeamError(400, "invalid_project", { reason: "name" });
      cur.name = body.name;
    }
    if (body.users !== undefined) {
      const users = parseUsers(body.users);
      if (users === null || (Array.isArray(users) && users.length === 0)) throw new TeamError(400, "invalid_project", { reason: "users" });
      cur.users = users;
    }
    if (body.contextFiles !== undefined) cur.contextFiles = body.contextFiles === true;
    this.writeFolderFile(stored);
  }

  disable(caller: Caller, id: string): void {
    if (!caller.admin) throw new TeamError(403, "admin_required");
    const stored = this.requireFolderProject(id);
    this.writeFolderFile(stored.filter((s) => s.id !== id));
  }
}
