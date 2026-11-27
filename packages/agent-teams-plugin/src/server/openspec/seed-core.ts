/**
 * Seed engine shared by both profiles (design D2): turns a preflight `SeedPlan` into core tasks, once.
 *  - Tasks are created through core's actor op `createTask` (server actor): no hook runs, core still enforces
 *    its caps and cycle rules. Creation is in TOPOLOGICAL order (core requires `blockedBy` to name existing
 *    tasks); ties keep list order, so one input always yields one order. Cycle members (and tasks that
 *    depend on one) are skipped and named in the lead notice.
 *  - Crash-safe: `seeding {startedAt}` is persisted BEFORE the first task, `seeded:true` + the refs after the
 *    last (2 sidecar writes in the happy path). `seeding && !seeded` is NEVER re-seeded (core persists tasks
 *    write-through, a re-seed would duplicate): it is `seed_incomplete`, with one waking lead notice.
 *  - Text from repository files is data: control/ANSI/bidi characters stripped silently, newlines in titles
 *    collapse to one space, lengths counted in code points and cut on a code-point boundary with core's marker.
 * See change: add-agent-teams-openspec.
 */
import { TASK_DESCRIPTION_MAX_CHARS, TASK_TITLE_MAX_CHARS, TRUNCATION_MARKER } from "../../shared/constants.js";
import { codePointLength, sanitizeText, truncateCodePoints } from "../../shared/text.js";
import type { Team } from "../../shared/types.js";
import type { Ops } from "../ops.js";
import { OPENSPEC_COUNTERS, type OpenspecLog } from "./log.js";
import type { SidecarData, SidecarInit, SidecarStore } from "./sidecar.js";

/** One task of a plan. `key` is a stable id (change name, checkbox id, `§n`) that `blockedBy` entries name. */
export interface SeedTask {
  key: string;
  title: string;
  description?: string;
  /** Keys of the tasks this one waits for. */
  blockedBy?: readonly string[];
  owner?: string;
  /** Owner becomes immutable for non-server actors (`owner_locked`). */
  ownerLocked?: boolean;
  /** Stored in the sidecar `refs` under the core task id (defaults to `key`). */
  ref?: unknown;
}

/** What preflight read, frozen: the seed never reads a repository file again. */
export interface SeedPlan {
  tasks: readonly SeedTask[];
  /** Pre-composed lead notice lines (ids and codes only), e.g. out-of-group blockers, skipped changes. */
  notes?: readonly string[];
  /** Extra sidecar fields written with the `seeded` marker. */
  sidecar?: { names?: Readonly<Record<string, string>>; ext?: Readonly<Record<string, unknown>> };
}

interface SeedSkip {
  key: string;
  reason: "cycle" | "depends_on_skipped" | "duplicate_key";
}

export interface TaskOrder {
  order: SeedTask[];
  skipped: SeedSkip[];
  /** `key→dep` edges dropped because the dependency is not in the plan or is the task itself. */
  droppedEdges: Array<{ key: string; dep: string }>;
}

/**
 * Deterministic topological order (Kahn; among ready tasks the lowest list index first). Duplicate keys,
 * cycle members and anything that (transitively) waits for a skipped task are reported in `skipped`.
 */
export function orderTasks(tasks: readonly SeedTask[]): TaskOrder {
  const skipped: SeedSkip[] = [];
  const droppedEdges: TaskOrder["droppedEdges"] = [];
  const index = new Map<string, number>();
  const list: SeedTask[] = [];
  for (const t of tasks) {
    if (index.has(t.key)) {
      skipped.push({ key: t.key, reason: "duplicate_key" });
      continue;
    }
    index.set(t.key, list.length);
    list.push(t);
  }
  const deps = list.map((t) => {
    const out = new Set<number>();
    for (const d of t.blockedBy ?? []) {
      const j = index.get(d);
      if (j === undefined || d === t.key) droppedEdges.push({ key: t.key, dep: d });
      else out.add(j);
    }
    return out;
  });
  const done = new Array<boolean>(list.length).fill(false);
  const order: SeedTask[] = [];
  for (let progressed = true; progressed; ) {
    progressed = false;
    for (let i = 0; i < list.length; i++) {
      if (done[i] || ![...(deps[i] as Set<number>)].every((j) => done[j])) continue;
      done[i] = true;
      order.push(list[i] as SeedTask);
      progressed = true;
      break; // restart from the lowest index: a freed task may precede the next candidate
    }
  }
  const rest = list.map((_, i) => i).filter((i) => !done[i]);
  const remaining = new Set(rest);
  const inCycle = (start: number): boolean => {
    const seen = new Set<number>();
    const stack = [...(deps[start] as Set<number>)].filter((j) => remaining.has(j));
    while (stack.length > 0) {
      const j = stack.pop() as number;
      if (j === start) return true;
      if (seen.has(j)) continue;
      seen.add(j);
      for (const k of deps[j] as Set<number>) if (remaining.has(k)) stack.push(k);
    }
    return false;
  };
  for (const i of rest) skipped.push({ key: (list[i] as SeedTask).key, reason: inCycle(i) ? "cycle" : "depends_on_skipped" });
  return { order, skipped, droppedEdges };
}

// ── text ──────────────────────────────────────────────────────────────────────

/** Drop UTF-16 surrogate code units that do not form a pair. */
function dropLoneSurrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      }
    } else if (c < 0xdc00 || c > 0xdfff) out += s[i];
  }
  return out;
}

/** Cut to `max` code points INCLUDING the marker, on a code-point boundary. */
function capCodePoints(text: string, max: number): string {
  if (codePointLength(text) <= max) return text;
  return truncateCodePoints(text, Math.max(0, max - codePointLength(TRUNCATION_MARKER))) + TRUNCATION_MARKER;
}

/** Seed text → stored text: strip controls/ANSI/bidi, collapse title newlines, cap in code points. */
function seedText(raw: unknown, opts: { multiline: boolean; max: number }): string {
  let t = typeof raw === "string" ? raw : "";
  if (!opts.multiline) t = t.replace(/[\r\n\u2028\u2029]+/g, " ");
  t = sanitizeText(dropLoneSurrogates(t), { keepNewlines: opts.multiline });
  return capCodePoints(opts.multiline ? t.trim() : t.replace(/ {2,}/g, " ").trim(), opts.max);
}

export const seedTitle = (raw: unknown): string => seedText(raw, { multiline: false, max: TASK_TITLE_MAX_CHARS }) || "(untitled)";
export const seedDescription = (raw: unknown): string => seedText(raw, { multiline: true, max: TASK_DESCRIPTION_MAX_CHARS });

// ── seeding ───────────────────────────────────────────────────────────────────

export type SeedOutcome =
  | { status: "seeded"; created: number; idByKey: Record<string, string>; skipped: SeedSkip[] }
  | { status: "already_seeded" }
  | { status: "seed_incomplete"; code: string; created: number }
  | { status: "refused"; error: "sidecar_write_failed" };

export interface SeedCoreDeps {
  ops: Pick<Ops, "createTask" | "enqueueLeadNotice">;
  sidecar: SidecarStore;
  log: OpenspecLog;
  clock: { now(): number };
}

const NOTE_MAX_CHARS = 300;
const NOTES_MAX = 20;

const safeNote = (s: string): string => seedText(s, { multiline: false, max: NOTE_MAX_CHARS });

interface Created {
  idByKey: Record<string, string>;
  refs: Record<string, unknown>;
  failure?: string;
}

/** The core `createTask` input of one seed task (sanitised text; `blockedBy` = core ids of already-created tasks). */
function createInput(t: SeedTask, idByKey: Readonly<Record<string, string>>): Parameters<Ops["createTask"]>[1] {
  const blockedBy = [...new Set((t.blockedBy ?? []).filter((k) => idByKey[k] !== undefined && k !== t.key).map((k) => idByKey[k] as string))];
  return {
    title: seedTitle(t.title),
    ...(t.description !== undefined && t.description !== "" ? { description: seedDescription(t.description) } : {}),
    ...(blockedBy.length > 0 ? { blockedBy } : {}),
    ...(t.owner !== undefined ? { owner: t.owner } : {}),
    ...(t.ownerLocked ? { ownerLocked: true } : {}),
  };
}

/** Create the ordered tasks through core; stops at the first refusal (or throw). */
function createInOrder(deps: SeedCoreDeps, team: Team, order: readonly SeedTask[]): Created {
  const out: Created = { idByKey: {}, refs: {} };
  for (const t of order) {
    let res: ReturnType<Ops["createTask"]>;
    try {
      res = deps.ops.createTask(team, createInput(t, out.idByKey), { actor: "server" });
    } catch (err) {
      deps.log.event("error", "seed_create_threw", team.id, { key: t.key, error: (err as Error).name });
      return { ...out, failure: "create_threw" };
    }
    if (!res.ok) return { ...out, failure: res.error };
    out.idByKey[t.key] = res.data.task.id;
    out.refs[res.data.task.id] = t.ref ?? t.key;
  }
  return out;
}

/** The lead notice of a complete seed (only when something was skipped or noted). */
function notifySeeded(deps: SeedCoreDeps, team: Team, created: number, notes: readonly string[]): void {
  if (notes.length === 0) return;
  const lines = notes.slice(0, NOTES_MAX).map((n) => `- ${safeNote(n)}`);
  if (notes.length > NOTES_MAX) lines.push(`- … ${notes.length - NOTES_MAX} more`);
  deps.ops.enqueueLeadNotice(team, { text: `OpenSpec seed: ${created} task(s) created.\n${lines.join("\n")}`, wake: false });
}

/** Core refusal / crash-equivalent: remember it (best effort), tell the lead once, never re-seed. */
function failIncomplete(deps: SeedCoreDeps, team: Team, code: string, refs: Record<string, unknown>): SeedOutcome {
  const created = Object.keys(refs).length;
  deps.sidecar.update(team.id, (d) => {
    d.seedIncomplete = { code };
    Object.assign(d.refs, refs);
    d.noticed.seed_incomplete = true;
  });
  deps.log.record("error", "seed_incomplete", OPENSPEC_COUNTERS.seedIncomplete, team.id, { code, created });
  deps.ops.enqueueLeadNotice(team, { text: seedIncompleteText(code, created), wake: true });
  return { status: "seed_incomplete", code, created };
}

/** The answer for a team that already has seed state (never seed twice, never seed over a half-done seed), else undefined. */
function priorOutcome(existing: Readonly<SidecarData> | undefined): SeedOutcome | undefined {
  if (existing?.seeded) return { status: "already_seeded" };
  if (existing?.lost) return { status: "seed_incomplete", code: "sidecar_missing", created: 0 };
  if (existing?.seeding || existing?.seedIncomplete) return { status: "seed_incomplete", code: existing.seedIncomplete?.code ?? "crash", created: 0 };
  return undefined;
}

/**
 * Seed `team` from `plan` exactly once. Never throws for a core refusal (that is `seed_incomplete`); a
 * failed FIRST sidecar write creates nothing and answers `refused`.
 */
export function seedCore(deps: SeedCoreDeps, team: Team, init: SidecarInit, plan: SeedPlan): SeedOutcome {
  const { sidecar, log, clock } = deps;
  const existing = sidecar.get(team.id);
  const prior = priorOutcome(existing);
  if (prior) return prior;

  const marker = (d: SidecarData): void => void (d.seeding = { startedAt: clock.now() });
  const started = existing ? sidecar.update(team.id, marker) : sidecar.create(init, marker);
  if (!started.ok) {
    log.record("error", "seed_refused", OPENSPEC_COUNTERS.sidecarWriteFailed, team.id, { code: started.error });
    return { status: "refused", error: "sidecar_write_failed" };
  }

  const { order, skipped, droppedEdges } = orderTasks(plan.tasks);
  const made = createInOrder(deps, team, order);
  if (made.failure !== undefined) return failIncomplete(deps, team, made.failure, made.refs);

  const sealed = sidecar.update(team.id, (d) => {
    d.seeded = true;
    Object.assign(d.refs, made.refs);
    if (plan.sidecar?.names) Object.assign(d.names, plan.sidecar.names);
    if (plan.sidecar?.ext) Object.assign(d.ext, plan.sidecar.ext);
  });
  if (!sealed.ok) return failIncomplete(deps, team, sealed.error, made.refs);
  log.record("info", "seeded", OPENSPEC_COUNTERS.seeded, team.id, { tasks: order.length, skipped: skipped.length });
  notifySeeded(deps, team, order.length, [...(plan.notes ?? []), ...skipped.map((s) => `skipped ${s.key}: ${s.reason}`), ...droppedEdges.map((e) => `dropped dependency ${e.key} -> ${e.dep}`)]);
  return { status: "seeded", created: order.length, idByKey: made.idByKey, skipped };
}

/** The waking lead notice of an incomplete seed (code and count only). */
export function seedIncompleteText(code: string, created: number): string {
  return `OpenSpec seed incomplete (${safeNote(code)}): ${created} task(s) were created. The rest will NOT be seeded again and no launcher or checkbox sync runs for this team; create the remaining tasks by hand or close the team.`;
}
