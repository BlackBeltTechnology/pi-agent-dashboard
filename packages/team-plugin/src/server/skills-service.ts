/**
 * Admin skill catalog (D1–D4, D14). Union of config entries (`skillCatalog`,
 * read-only) and managed entries (`<teamHome>/skills.json`, schemaVersion 1,
 * written under an in-process mutex). One identity: the catalog name IS the
 * skill's pi name. Every consumer reads normalised entries through this
 * service. See change: add-team-skill-access.
 */
import fs from "node:fs";
import path from "node:path";
import type { Access } from "./access.js";
import type { HostSession, Logger } from "./conversations.js";
import { atomicWriteJson, canonicalize, type FsOps, isInside, isTargetId, realFs, type TeamPaths, userKey } from "./paths.js";
import type { ProjectRegistry } from "./projects.js";
import type { LocatedRecord } from "./records.js";
import { type Caller, type Mode, type Persona, type PersonaScope, type SkillCatalogEntry, type TeamConfig, TeamError } from "./types.js";

type SkillUsers = "*" | { iss: string; sub: string }[];
type SkillTargets = "*" | string[];

/** Normalised catalog entry (legacy string + missing users/targets defaulted to `"*"`). */
export interface SkillEntry {
  name: string;
  source: "config" | "managed";
  path: string;
  users: SkillUsers;
  targets: SkillTargets;
}

export type SkillBlockReason = "missing" | "invalid" | "users" | "targets";

const SKILL_PATH_MAX_BYTES = 512;

/** pi skill name: `[a-z0-9-]`, 1–64 chars, no leading/trailing/doubled hyphen. */
const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;

function isValidSkillName(name: unknown): name is string {
  return typeof name === "string" && SKILL_NAME_RE.test(name);
}

/** D4 predicate: (single-user, or users match exactly) ∧ targets match. Pure. */
export function allowed(entry: Pick<SkillEntry, "users" | "targets">, caller: Caller, target: string, mode: Mode): boolean {
  const usersOk =
    mode === "single" || entry.users === "*" || entry.users.some((u) => u.iss === caller.iss && u.sub === caller.sub);
  const targetsOk = entry.targets === "*" || entry.targets.includes(target);
  return usersOk && targetsOk;
}

export interface CheckedSkill {
  entry: SkillEntry;
  valid: boolean;
  /** realpath directory granted to the guard; only when valid. */
  root?: string;
  invalidReason?: string;
  description?: string;
}

export interface SkillSnapshot {
  rows: CheckedSkill[];
  byName: Map<string, CheckedSkill>;
  managedLoadError: string | null;
}

export interface AdminSkillRow {
  name: string;
  source: "config" | "managed";
  path: string;
  users: SkillUsers;
  targets: SkillTargets;
  valid: boolean;
  invalidReason?: string;
  description?: string;
  usage: { personas: number; liveSessions: number };
}

export interface ImpactPreview {
  endSessions: number;
  blockedPersonas: { key: string; name: string; lostTargets: string[] }[];
  otherUsersPrivate: number;
}

export interface OperatorSkill {
  name: string;
  description: string;
  path: string;
  source: string;
}

/** Read-side persona access for the usage/impact passes (all users' private personas). */
interface SkillPersonaSource {
  get(key: string, uk: string): Persona | null;
  listShared(): Persona[];
  allPrivate(): { uk: string; persona: Persona }[];
}

interface SkillRecords {
  scanAll(): LocatedRecord[];
}

interface ManagedRecord {
  name: string;
  path: string;
  users: SkillUsers;
  targets: SkillTargets;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

interface ManagedFile {
  schemaVersion: 1;
  skills: ManagedRecord[];
}

export interface SkillsServiceDeps {
  paths: TeamPaths;
  projects: ProjectRegistry;
  access: Access;
  config: () => TeamConfig;
  logger: Logger;
  personas: SkillPersonaSource;
  records: SkillRecords;
  getSession: (id: string) => HostSession | undefined;
  /** pi agent dir (`~/.pi/agent`): a skill root may lie inside it, never contain it. */
  agentDir: string;
  /** Parent of every per-cwd pi session dir (holds every team transcript). */
  sessionsRoot: string;
  /** Dashboard home (`~/.pi/dashboard`). */
  dashboardHome: string;
  /** `host.listOperatorSkills`; absent on older hosts → `available()` answers `[]`. */
  listOperatorSkills?: () => Promise<OperatorSkill[]>;
  /**
   * D8 seam, called after a successful managed update/delete with the entry
   * before and after and the admin's uk (for the per-end audit line); returns
   * the number of sessions the change ended. Absent → 0.
   */
  onManagedWrite?: (name: string, before: SkillEntry | null, after: SkillEntry | null, by: string) => number | Promise<number>;
  ops?: FsOps;
  now?: () => Date;
}

function parseUsers(v: unknown): SkillUsers | null {
  if (v === undefined || v === "*") return "*";
  if (Array.isArray(v) && v.every((u) => !!u && typeof (u as { iss?: unknown }).iss === "string" && typeof (u as { sub?: unknown }).sub === "string")) {
    return v.map((u: { iss: string; sub: string }) => ({ iss: u.iss, sub: u.sub }));
  }
  return null;
}

function parseTargets(v: unknown): SkillTargets | null {
  if (v === undefined || v === "*") return "*";
  if (Array.isArray(v) && v.length > 0 && v.every((t) => isTargetId(t))) return v as string[];
  return null;
}

/** Frontmatter scalar fields of a SKILL.md (naive `key: value` scan between the `---` fences). */
function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  if ((lines[0] ?? "").trim() !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const WRITE_KEYS = new Set(["name", "path", "users", "targets"]);

export class SkillsService {
  private readonly ops: FsOps;
  private readonly file: string;
  private managed: { error: string | null; records: ManagedRecord[] } | undefined;
  private readonly warned = new Set<string>();
  /** Skill descriptions memoised by the SKILL.md file's (realpath, mtimeMs, size). */
  private readonly descMemo = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();
  private epochN = 0;

  constructor(private readonly d: SkillsServiceDeps) {
    this.ops = d.ops ?? realFs;
    this.file = path.join(d.paths.home, "skills.json");
  }

  /** Monotonic counter, bumped by every successful managed write (check-then-act seam, D6). */
  epoch(): number {
    return this.epochN;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }

  // ── managed store ────────────────────────────────────────────────────────

  /** Loaded once, then kept in memory; a bad file is ignored and blocks writes. */
  private loadManaged(): { error: string | null; records: ManagedRecord[] } {
    if (this.managed) return this.managed;
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      return (this.managed = { error: null, records: [] });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.d.logger.warn("team.skills_store_invalid reason=unreadable");
      return (this.managed = { error: "unreadable", records: [] });
    }
    const f = parsed as ManagedFile | null;
    if (f?.schemaVersion !== 1 || !Array.isArray(f.skills)) {
      this.d.logger.warn("team.skills_store_invalid reason=schema_version");
      return (this.managed = { error: "schema_version", records: [] });
    }
    const records: ManagedRecord[] = [];
    for (const r of f.skills) {
      const users = parseUsers(r?.users);
      const targets = parseTargets(r?.targets);
      if (typeof r?.name !== "string" || typeof r.path !== "string" || !users || !targets) {
        this.d.logger.warn("team.skills_store_invalid reason=entry_shape");
        continue;
      }
      records.push({ ...r, users, targets });
    }
    return (this.managed = { error: null, records });
  }

  private persist(records: ManagedRecord[]): void {
    atomicWriteJson(this.file, { schemaVersion: 1, skills: records } satisfies ManagedFile, this.ops);
    this.managed = { error: null, records };
    this.epochN++;
  }

  // ── normalisation + validation ───────────────────────────────────────────

  private normalise(name: string, value: unknown, source: SkillEntry["source"]): SkillEntry | null {
    const v = (typeof value === "string" ? { path: value } : value) as Partial<SkillCatalogEntry> | null;
    if (!v || typeof v.path !== "string" || v.path.length === 0) return null;
    const users = parseUsers(v.users);
    const targets = parseTargets(v.targets);
    if (!users || !targets) return null;
    return { name, source, path: v.path, users, targets };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear validation ladder per rejection reason
  private validatePath(raw: string): { ok: true; root: string } | { ok: false; reason: string } {
    if (typeof raw !== "string" || raw.length === 0 || raw.includes("\0") || !path.isAbsolute(raw)) return { ok: false, reason: "not_absolute" };
    if (Buffer.byteLength(raw, "utf8") > SKILL_PATH_MAX_BYTES) return { ok: false, reason: "too_long" };
    let real: string;
    let st: fs.Stats;
    try {
      real = fs.realpathSync(raw);
      st = fs.statSync(real);
    } catch {
      return { ok: false, reason: "missing" };
    }
    if (!st.isDirectory()) return { ok: false, reason: "not_directory" };
    try {
      if (!fs.statSync(path.join(real, "SKILL.md")).isFile()) return { ok: false, reason: "no_skill_md" };
    } catch {
      return { ok: false, reason: "no_skill_md" };
    }
    // Bidirectional exclusion (D3): never inside team home / project roots, never containing
    // team home / project roots / agent dir / sessions root / dashboard home.
    for (const p of this.d.projects.all()) {
      if (p.path && (isInside(p.path, real) || isInside(real, p.path))) return { ok: false, reason: "protected_dir" };
    }
    if (isInside(this.d.paths.home, real) || isInside(real, this.d.paths.home)) return { ok: false, reason: "protected_dir" };
    for (const fixed of [this.d.agentDir, this.d.sessionsRoot, this.d.dashboardHome]) {
      if (isInside(real, canonicalize(fixed))) return { ok: false, reason: "protected_dir" };
    }
    return { ok: true, root: real };
  }

  private checkEntry(entry: SkillEntry): CheckedSkill {
    const v = this.validatePath(entry.path);
    if (!v.ok) return this.invalid(entry, v.reason);
    const fm = this.frontmatter(v.root);
    const piName = fm.name || path.basename(v.root);
    if (piName !== entry.name) return this.invalid(entry, "name_mismatch");
    return { entry, valid: true, root: v.root, description: this.description(v.root, fm) };
  }

  private invalid(entry: SkillEntry, reason: string): CheckedSkill {
    this.warnInvalid(entry.name, reason);
    return { entry, valid: false, invalidReason: reason };
  }

  private warnInvalid(name: string, reason: string): void {
    const k = `${name}:${reason}`;
    if (this.warned.has(k)) return;
    this.warned.add(k);
    this.d.logger.warn(`team.skill_invalid name=${name} reason=${reason}`);
  }

  private frontmatter(root: string): Record<string, string> {
    try {
      return parseFrontmatter(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"));
    } catch {
      return {};
    }
  }

  private description(root: string, fm?: Record<string, string>): string | undefined {
    const md = path.join(root, "SKILL.md");
    try {
      const st = fs.statSync(md);
      const key = `${root}:${st.mtimeMs}:${st.size}`;
      const hit = this.descMemo.get(key);
      if (hit !== undefined) return hit;
      if (this.descMemo.size > 1000) this.descMemo.clear();
      const d = (fm ?? parseFrontmatter(fs.readFileSync(md, "utf8"))).description ?? "";
      this.descMemo.set(key, d);
      return d;
    } catch {
      return undefined;
    }
  }

  // ── snapshot + decisions ─────────────────────────────────────────────────

  /** Union of config and managed entries, each validated once per call. */
  snapshot(): SkillSnapshot {
    const rows: CheckedSkill[] = [];
    const byName = new Map<string, CheckedSkill>();
    const config = this.d.config().skillCatalog ?? {};
    for (const [name, value] of Object.entries(config)) {
      if (!isValidSkillName(name)) {
        this.warnInvalid(name, "invalid_name");
        continue;
      }
      const entry = this.normalise(name, value, "config");
      if (!entry) {
        this.warnInvalid(name, "invalid_entry");
        continue;
      }
      const chk = this.checkEntry(entry);
      rows.push(chk);
      byName.set(name, chk);
    }
    const configNames = new Set(byName.keys());
    for (const r of this.loadManaged().records) {
      const entry = this.normalise(r.name, r, "managed");
      const chk = entry ? this.checkEntry(entry) : this.invalid({ name: r.name, source: "managed", path: r.path, users: r.users, targets: r.targets }, "invalid_entry");
      if (configNames.has(r.name)) {
        // D2: config wins; the managed entry is reported invalid.
        chk.valid = false;
        chk.invalidReason = "shadowed_by_config";
        delete chk.root;
        delete chk.description;
      }
      rows.push(chk);
      if (!configNames.has(r.name)) byName.set(r.name, chk);
    }
    return { rows, byName, managedLoadError: this.loadManaged().error };
  }

  lookup(name: string, snap: SkillSnapshot = this.snapshot()): CheckedSkill | null {
    return snap.byName.get(name) ?? null;
  }

  /** D4 + D3 in one: existence, validity, users, targets — for persona saves (D5). */
  checkSave(name: string, caller: Caller, target: string, scope: PersonaScope, snap: SkillSnapshot = this.snapshot()): "ok" | "unknown" | "not_allowed" {
    const chk = snap.byName.get(name) ?? null;
    if (!chk) return "unknown";
    if (!chk.valid || !chk.root) return "not_allowed";
    if (scope === "shared") {
      // Shared personas are user-agnostic at save time; only targets bind.
      const e = chk.entry;
      return e.targets === "*" || e.targets.includes(target) ? "ok" : "not_allowed";
    }
    return allowed(chk.entry, caller, target, this.d.access.mode()) ? "ok" : "not_allowed";
  }

  /** D6/D14 helper: first failing skill in persona order, or null. */
  firstBlockedSkill(
    skills: readonly string[],
    caller: Caller,
    target: string,
    snap: SkillSnapshot = this.snapshot(),
  ): { skill: string; reason: SkillBlockReason } | null {
    const mode = this.d.access.mode();
    for (const name of skills) {
      const chk = snap.byName.get(name);
      if (!chk) return { skill: name, reason: "missing" };
      if (!chk.valid || !chk.root) return { skill: name, reason: "invalid" };
      if (!allowed(chk.entry, caller, target, mode)) {
        const e = chk.entry;
        const usersOk = mode === "single" || e.users === "*" || e.users.some((u) => u.iss === caller.iss && u.sub === caller.sub);
        return { skill: name, reason: usersOk ? "targets" : "users" };
      }
    }
    return null;
  }

  /** The persona's skill names the caller may use in the target, in persona order. */
  effectiveSkills(skills: readonly string[], caller: Caller, target: string, snap: SkillSnapshot = this.snapshot()): string[] {
    return skills.filter((n) => this.firstBlockedSkill([n], caller, target, snap) === null);
  }

  /** Spawn resolver (slice C transport): {name, realpath root} for an allowed skill, else null. */
  resolveSkillRoot(name: string, caller: Caller, target: string, snap: SkillSnapshot = this.snapshot()): { name: string; root: string } | null {
    const chk = snap.byName.get(name);
    if (!chk?.valid || !chk.root) return null;
    if (!allowed(chk.entry, caller, target, this.d.access.mode())) return null;
    return { name, root: chk.root };
  }

  // ── listings ─────────────────────────────────────────────────────────────

  /** `/me` + non-admin listing names: allowed for at least one usable target. */
  visibleNames(caller: Caller, usableTargets: readonly string[], snap: SkillSnapshot = this.snapshot()): string[] {
    const mode = this.d.access.mode();
    const out: string[] = [];
    for (const chk of snap.byName.values()) {
      if (!chk.valid) continue;
      if (usableTargets.some((t) => allowed(chk.entry, caller, t, mode))) out.push(chk.entry.name);
    }
    return out.sort();
  }

  callerList(caller: Caller, usableTargets: readonly string[], snap: SkillSnapshot = this.snapshot()): { skills: { name: string; description?: string; targets: string[] }[] } {
    const mode = this.d.access.mode();
    const skills: { name: string; description?: string; targets: string[] }[] = [];
    for (const chk of snap.byName.values()) {
      if (!chk.valid) continue;
      const targets = usableTargets.filter((t) => allowed(chk.entry, caller, t, mode));
      if (targets.length > 0) skills.push({ name: chk.entry.name, description: chk.description, targets });
    }
    return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  adminList(snap: SkillSnapshot = this.snapshot()): { skills: AdminSkillRow[]; managedLoadError?: string } {
    const usage = this.usage();
    const skills = snap.rows
      .map((chk) => this.rowOf(chk, usage))
      .sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
    return { skills, ...(snap.managedLoadError ? { managedLoadError: snap.managedLoadError } : {}) };
  }

  private rowOf(chk: CheckedSkill, usage: Map<string, { personas: number; liveSessions: number }>): AdminSkillRow {
    return {
      name: chk.entry.name,
      source: chk.entry.source,
      path: chk.entry.path,
      users: chk.entry.users,
      targets: chk.entry.targets,
      valid: chk.valid,
      ...(chk.invalidReason ? { invalidReason: chk.invalidReason } : {}),
      ...(chk.description !== undefined ? { description: chk.description } : {}),
      usage: usage.get(chk.entry.name) ?? { personas: 0, liveSessions: 0 },
    };
  }

  /** Live, owner-bound conversation records (same binding rule as `sweepIdle`). */
  private liveRecords(): LocatedRecord[] {
    const multi = this.d.access.mode() === "multi";
    const out: LocatedRecord[] = [];
    for (const lr of this.d.records.scanAll()) {
      if (lr.record.archived) continue;
      const s = this.d.getSession(lr.record.sessionId);
      if (!s || s.status === "ended") continue;
      if (multi && (!s.principalOwner || userKey(s.principalOwner.iss, s.principalOwner.sub) !== lr.uk)) continue;
      out.push(lr);
    }
    return out;
  }

  private usage(): Map<string, { personas: number; liveSessions: number }> {
    const counts = new Map<string, { personas: number; liveSessions: number }>();
    const bump = (name: string, k: "personas" | "liveSessions") => {
      const c = counts.get(name) ?? { personas: 0, liveSessions: 0 };
      c[k]++;
      counts.set(name, c);
    };
    for (const p of this.d.personas.listShared()) for (const n of p.skills ?? []) bump(n, "personas");
    for (const { persona } of this.d.personas.allPrivate()) for (const n of persona.skills ?? []) bump(n, "personas");
    for (const lr of this.liveRecords()) {
      const p = this.d.personas.get(lr.record.personaKey, lr.uk);
      for (const n of p?.skills ?? []) bump(n, "liveSessions");
    }
    return counts;
  }

  /** `GET /skills/available`: the operator's global skills; `[]` without the host service (D11). */
  async available(): Promise<OperatorSkill[]> {
    return (await this.d.listOperatorSkills?.()) ?? [];
  }

  // ── managed writes ───────────────────────────────────────────────────────

  private requireAdmin(caller: Caller): void {
    if (!caller.admin) throw new TeamError(403, "admin_required");
  }

  private bodyFields(body: unknown, allowedKeys: string[]): { b: Record<string, unknown>; fields: Record<string, string> } {
    const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const k of Object.keys(b)) if (!allowedKeys.includes(k)) fields[k] = "unknown_field";
    return { b, fields };
  }

  private throwInvalid(fields: Record<string, string>): never {
    throw new TeamError(400, "invalid_skill", { fields });
  }

  /** `fields.name = "name_mismatch"` for identity failures, `fields.path` for path failures. */
  private fieldsOf(invalidReason: string): Record<string, string> {
    return invalidReason === "name_mismatch" ? { name: "name_mismatch" } : { path: invalidReason };
  }

  async create(caller: Caller, body: unknown): Promise<AdminSkillRow> {
    this.requireAdmin(caller);
    const { b, fields } = this.bodyFields(body, [...WRITE_KEYS]);
    if (!isValidSkillName(b.name)) fields.name = "invalid_name";
    if (typeof b.path !== "string" || b.path.length === 0) fields.path = "invalid_path";
    const users = parseUsers(b.users);
    const targets = parseTargets(b.targets);
    if (!users || !targets) {
      if (!users) fields.users = "invalid_users";
      if (!targets) fields.targets = "invalid_targets";
      this.throwInvalid(fields);
    }
    if (Object.keys(fields).length > 0) this.throwInvalid(fields);
    const name = b.name as string;
    const rawPath = b.path as string;
    return this.enqueue(async () => {
      const state = this.loadManaged();
      if (state.error) throw new TeamError(503, "skill_store_unavailable");
      if (Object.hasOwn(this.d.config().skillCatalog ?? {}, name) || state.records.some((r) => r.name === name)) {
        throw new TeamError(409, "skill_exists");
      }
      const chk = this.checkEntry({ name, source: "managed", path: rawPath, users, targets });
      if (!chk.valid) this.throwInvalid(this.fieldsOf(chk.invalidReason as string));
      const stamp = (this.d.now?.() ?? new Date()).toISOString();
      this.persist([
        ...state.records,
        { name, path: rawPath, users, targets, createdAt: stamp, createdBy: caller.uk, updatedAt: stamp, updatedBy: caller.uk },
      ]);
      this.d.logger.info(`team.skill_write op=create name=${name} by=${caller.uk}`);
      return this.rowOf(chk, new Map());
    });
  }

  async update(caller: Caller, name: string, body: unknown): Promise<AdminSkillRow> {
    this.requireAdmin(caller);
    const { b, fields } = this.bodyFields(body, ["path", "users", "targets"]);
    const users = b.users === undefined ? "*" : parseUsers(b.users);
    const targets = b.targets === undefined ? "*" : parseTargets(b.targets);
    if (b.path !== undefined && (typeof b.path !== "string" || b.path.length === 0)) fields.path = "invalid_path";
    if (b.users !== undefined && !users) fields.users = "invalid_users";
    if (b.targets !== undefined && !targets) fields.targets = "invalid_targets";
    if (Object.keys(fields).length > 0) this.throwInvalid(fields);
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: optional-field merge with per-field validation
    return this.enqueue(async () => {
      const state = this.loadManaged();
      if (state.error) throw new TeamError(503, "skill_store_unavailable");
      if (Object.hasOwn(this.d.config().skillCatalog ?? {}, name)) throw new TeamError(409, "skill_readonly");
      const i = state.records.findIndex((r) => r.name === name);
      if (i < 0) throw new TeamError(404, "skill_not_found");
      const cur = state.records[i];
      const merged = {
        path: (b.path as string) ?? cur.path,
        users: b.users === undefined ? cur.users : (users as SkillUsers),
        targets: b.targets === undefined ? cur.targets : (targets as SkillTargets),
      };
      const before = this.normalise(name, cur, "managed");
      const chk = this.checkEntry({ name, source: "managed", ...merged });
      if (!chk.valid) this.throwInvalid(this.fieldsOf(chk.invalidReason as string));
      const stamp = (this.d.now?.() ?? new Date()).toISOString();
      this.persist(state.records.map((r, j) => (j === i ? { ...r, ...merged, updatedAt: stamp, updatedBy: caller.uk } : r)));
      this.d.logger.info(`team.skill_write op=update name=${name} by=${caller.uk}`);
      const ended = (await this.d.onManagedWrite?.(name, before, chk.entry, caller.uk)) ?? 0;
      this.d.logger.info(`team.skill_invalidated name=${name} sessions=${ended}`);
      return this.rowOf(chk, new Map());
    });
  }

  async remove(caller: Caller, name: string): Promise<void> {
    this.requireAdmin(caller);
    await this.enqueue(async () => {
      const state = this.loadManaged();
      if (state.error) throw new TeamError(503, "skill_store_unavailable");
      if (Object.hasOwn(this.d.config().skillCatalog ?? {}, name)) throw new TeamError(409, "skill_readonly");
      const i = state.records.findIndex((r) => r.name === name);
      if (i < 0) throw new TeamError(404, "skill_not_found");
      const before = this.normalise(name, state.records[i], "managed");
      this.persist(state.records.filter((_, j) => j !== i));
      this.d.logger.info(`team.skill_write op=delete name=${name} by=${caller.uk}`);
      const ended = (await this.d.onManagedWrite?.(name, before, null, caller.uk)) ?? 0;
      this.d.logger.info(`team.skill_invalidated name=${name} sessions=${ended}`);
    });
  }

  // ── impact preview (D8/D14, dry run) ─────────────────────────────────────

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dry-run decision table over personas and live sessions
  async impact(caller: Caller, name: string, body: unknown): Promise<ImpactPreview> {
    this.requireAdmin(caller);
    const { b, fields } = this.bodyFields(body, ["path", "users", "targets", "remove"]);
    if (b.remove !== undefined && typeof b.remove !== "boolean") fields.remove = "invalid_remove";
    if (Object.keys(fields).length > 0) this.throwInvalid(fields);
    const snap = this.snapshot();
    const cur = snap.byName.get(name);
    if (!cur) throw new TeamError(404, "skill_not_found");

    let after: CheckedSkill | null = null;
    if (b.remove !== true) {
      const users = b.users === undefined ? cur.entry.users : parseUsers(b.users);
      const targets = b.targets === undefined ? cur.entry.targets : parseTargets(b.targets);
      const rawPath = b.path === undefined ? cur.entry.path : b.path;
      if (!users || !targets || typeof rawPath !== "string") this.throwInvalid({ path: "invalid_path" });
      const chk = this.checkEntry({ name, source: cur.entry.source, path: rawPath as string, users, targets });
      if (!chk.valid) this.throwInvalid(this.fieldsOf(chk.invalidReason as string));
      after = chk;
    }

    const mode = this.d.access.mode();
    const before: CheckedSkill | null = cur.valid ? cur : null;
    const rootChanged = before !== null && after !== null && before.root !== after.root;
    const principalOf = (p: { iss: string; sub: string }): Caller => ({ uk: "", iss: p.iss, sub: p.sub, admin: false });
    const beforeAllows = (principal: Caller, t: string) => before !== null && allowed(before.entry, principal, t, mode);
    const afterAllows = (principal: Caller, t: string) => after !== null && allowed(after.entry, principal, t, mode) && !rootChanged;
    const targetsOk = (e: { targets: SkillTargets }, t: string) => e.targets === "*" || e.targets.includes(t);
    const someUser = (e: { users: SkillUsers }) => e.users === "*" || e.users.length > 0;
    const beforeShared = (t: string) => before !== null && targetsOk(before.entry, t) && someUser(before.entry);
    const afterShared = (t: string) => after !== null && targetsOk(after.entry, t) && someUser(after.entry) && !rootChanged;

    let endSessions = 0;
    for (const lr of this.liveRecords()) {
      const p = this.d.personas.get(lr.record.personaKey, lr.uk);
      if (!p?.skills?.includes(name)) continue;
      const owner = mode === "single" ? { iss: "local", sub: "local" } : this.d.getSession(lr.record.sessionId)?.principalOwner;
      if (!owner) continue;
      if (beforeAllows(principalOf(owner), lr.t) && !afterAllows(principalOf(owner), lr.t)) endSessions++;
    }

    const blockedPersonas: ImpactPreview["blockedPersonas"] = [];
    let otherUsersPrivate = 0;
    const consider = (p: Persona, ownerUk: string | null) => {
      if (!p.skills?.includes(name)) return;
      let lost: string[];
      if (p.scope === "private" && p.owner) {
        const principal = principalOf(p.owner);
        lost = p.projects.filter((t) => beforeAllows(principal, t) && !afterAllows(principal, t));
      } else {
        lost = p.projects.filter((t) => beforeShared(t) && !afterShared(t));
      }
      if (lost.length === 0) return;
      if (ownerUk !== null && ownerUk !== caller.uk) otherUsersPrivate++;
      else blockedPersonas.push({ key: p.key, name: p.name, lostTargets: lost });
    };
    for (const p of this.d.personas.listShared()) consider(p, null);
    for (const { uk, persona } of this.d.personas.allPrivate()) consider(persona, uk);
    return { endSessions, blockedPersonas, otherUsersPrivate };
  }
}
