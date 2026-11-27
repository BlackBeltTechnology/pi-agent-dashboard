/**
 * The `openspec-apply` profile: preflight stages + seed plan (design D7, spec "Seed tasks from tasks.md",
 * "Section tasks fit the task caps", "Dependencies from section order and hints", "Review task and reviewer
 * member", "Apply preflight outcomes").
 *
 *  - `analyzeApply` is PURE: the checkbox list of `GET /api/openspec/tasks` + the raw file text (hints only)
 *    in, a frozen `SeedPlan` out (the seed never reads a file again).
 *  - Unit: one task per unticked checkbox while that count is at most `maxTasks − 2`, else one per `##`
 *    section that still has an unticked box; more units than that ⇒ `too_many_tasks`. Ticked boxes are skipped
 *    and count as satisfied blockers.
 *  - Default `blockedBy`: the unticked boxes of the previous section that still has one; a hint replaces it.
 *  - The final `Review` task waits for every unit. It is meant for `reviewer`, but core only accepts an owner
 *    that is a live member and the roster spawns AFTER the seed: the owner is set when `reviewer` appears
 *    (`apply.ts`), and until then the dispatch rule keeps the reviewer off every other task.
 *  - Refs (sidecar, per core task id): `{ boxes: [{ id, textHash }] }` for a unit, `{ review: true }` for Review.
 * See change: add-agent-teams-openspec.
 */

import path from "node:path";
import { codePointLength, truncateCodePoints } from "../../shared/text.js";
import { describeHintReport, type HintBox, type RawScan, resolveHints, scanHints, sectionIndexOf, stripTrailingHint } from "./hints.js";
import { readBoundedFile, resolveChangeDir } from "./inputs.js";
import { changesInUse, checkSkillStage, type OpenspecApi, type OpenspecKindImpl, type PreflightCtx, type Refusal } from "./profiles.js";
import type { SeedPlan, SeedTask } from "./seed-core.js";
import { type BoxRef, createTasksSource, normalizeBoxText, type SourceTask, textHash } from "./tasks-source.js";

export const REVIEW_KEY = "review";
export const REVIEWER_NAME = "reviewer";
/** Slots kept for the `Review` task and one lead-created task. */
const RESERVED_TASK_SLOTS = 2;
export const SECTION_DESCRIPTION_MAX = 2000;
const SECTION_LINE_TEXT_MAX = 80;

/** Sidecar ref of one seeded unit. */
interface ApplyRef {
  boxes: BoxRef[];
}
export interface ReviewRef {
  review: true;
}

export const isReviewRef = (v: unknown): v is ReviewRef => typeof v === "object" && v !== null && (v as ReviewRef).review === true;
export function boxRefsOf(v: unknown): BoxRef[] | undefined {
  const boxes = typeof v === "object" && v !== null ? (v as ApplyRef).boxes : undefined;
  if (!Array.isArray(boxes)) return undefined;
  const ok = boxes.every((b) => typeof b === "object" && b !== null && typeof (b as BoxRef).id === "string" && typeof (b as BoxRef).textHash === "string");
  return ok ? (boxes as BoxRef[]) : undefined;
}

export interface ApplyAnalysis {
  mode: "box" | "section";
  /** Unticked checkboxes. */
  unticked: number;
  /** Implementation tasks the plan creates (excludes `Review`). */
  units: number;
  plan: SeedPlan;
}

const cap = (maxTasks: number): number => Math.max(0, maxTasks - RESERVED_TASK_SLOTS);

/** `"5. Apply profile"` → `"Apply profile"`. */
const headingLabel = (group: string): string => group.replace(/^\s*\d+[.):]?\s*/, "").trim();

/** The listing line of a box in a section description: `id` + the first 80 characters (code points) of its text. */
function listLine(b: SourceTask): string {
  const text = normalizeBoxText(b.text);
  return `${b.id} ${truncateCodePoints(text, SECTION_LINE_TEXT_MAX)}`.trimEnd();
}

/**
 * Section description: one line per box (id + the first 80 code points of its text). The pointer to the full
 * list is appended whenever the listing is not the whole story — a line was shortened or the listing had to be
 * cut — and the result is never above 2000 code points (counted in code points, cut on a line boundary).
 */
export function sectionDescription(boxes: readonly SourceTask[], sectionNumber: number): string {
  const lines = boxes.map(listLine);
  const shortened = boxes.some((b) => codePointLength(normalizeBoxText(b.text)) > SECTION_LINE_TEXT_MAX);
  const full = lines.join("\n");
  if (!shortened && codePointLength(full) <= SECTION_DESCRIPTION_MAX) return full;
  const pointer = `full list: tasks.md section ${sectionNumber}`;
  const withPointer = `${full}\n${pointer}`;
  if (codePointLength(withPointer) <= SECTION_DESCRIPTION_MAX) return withPointer;
  const budget = SECTION_DESCRIPTION_MAX - codePointLength(pointer) - 1;
  const kept: string[] = [];
  let used = 0;
  for (const l of lines) {
    const next = used + codePointLength(l) + (kept.length > 0 ? 1 : 0);
    if (next > budget) break;
    kept.push(l);
    used = next;
  }
  return [...kept, pointer].join("\n");
}

interface Unit {
  key: string;
  boxes: SourceTask[];
  section: number;
}

/** Pure analysis: checkbox list + raw text → counts and the plan. */
export function analyzeApply(input: { change: string; tasks: readonly SourceTask[]; raw: string; maxTasks: number }): ApplyAnalysis {
  const { change, raw, maxTasks } = input;
  const scan: RawScan = scanHints(raw);
  const tasks = [...input.tasks].sort((a, b) => a.line - b.line);
  const hintBoxes: HintBox[] = tasks.map((t) => ({ id: t.id, line: t.line, done: t.done }));
  const { blockers, reports } = resolveHints(scan, hintBoxes);

  const open = tasks.filter((t) => !t.done);
  const sectionOfLine = new Map<number, number>(open.map((t) => [t.line, sectionIndexOf(scan, t.line)]));
  const openBySection = new Map<number, SourceTask[]>();
  for (const t of open) openBySection.set(sectionOfLine.get(t.line) as number, [...(openBySection.get(sectionOfLine.get(t.line) as number) ?? []), t]);
  const sectionOrder = [...openBySection.keys()].sort((a, b) => a - b);
  const numberOf = (idx: number): number => (idx < 0 ? 0 : (scan.sections[idx]?.number as number));

  const mode: ApplyAnalysis["mode"] = open.length <= cap(maxTasks) ? "box" : "section";
  const units: Unit[] =
    mode === "box"
      ? open.map((b) => ({ key: `b${b.line}`, boxes: [b], section: sectionOfLine.get(b.line) as number }))
      : sectionOrder.map((idx) => ({ key: `s${idx}`, boxes: openBySection.get(idx) as SourceTask[], section: idx }));
  const unitKeyOfLine = new Map<number, string>();
  for (const u of units) for (const b of u.boxes) unitKeyOfLine.set(b.line, u.key);

  /** Box lines this box waits for: its hint, else the previous non-empty section (default barrier). */
  const blockerLines = (b: SourceTask): ReadonlySet<number> => {
    const explicit = blockers.get(b.line);
    if (explicit) return explicit;
    const idx = sectionOfLine.get(b.line) as number;
    const prev = [...sectionOrder].reverse().find((s) => s < idx);
    return new Set((prev === undefined ? [] : (openBySection.get(prev) ?? [])).map((x) => x.line));
  };

  const seedTasks: SeedTask[] = units.map((u) => {
    const keys = new Set<string>();
    for (const b of u.boxes) for (const line of blockerLines(b)) keys.add(unitKeyOfLine.get(line) as string);
    keys.delete(u.key);
    const refs: ApplyRef = { boxes: u.boxes.map((b) => ({ id: b.id, textHash: textHash(b.text) })) };
    if (mode === "box") {
      const b = u.boxes[0] as SourceTask;
      return {
        key: u.key,
        title: `${b.id} ${stripTrailingHint(b.text)}`,
        description: `Checkbox ${b.id} of OpenSpec change ${change} (tasks.md section ${numberOf(u.section)}). The runtime ticks the checkbox when you complete this task; do not edit tasks.md.`,
        blockedBy: [...keys],
        ref: refs,
      };
    }
    const label = headingLabel((u.boxes[0] as SourceTask).group);
    return {
      key: u.key,
      title: `Section ${numberOf(u.section)}${label ? `: ${label}` : ""}`,
      description: sectionDescription(u.boxes, numberOf(u.section)),
      blockedBy: [...keys],
      ref: refs,
    };
  });

  const review: SeedTask = {
    key: REVIEW_KEY,
    title: "Review",
    description: `Review the whole implementation of OpenSpec change ${change} against its tasks.md, proposal and specs (read-only). Report findings; do not edit files.`,
    blockedBy: units.map((u) => u.key),
    ref: { review: true } satisfies ReviewRef,
  };

  const notes = [...(mode === "section" ? [`${open.length} unticked checkboxes: one task per section (${units.length} tasks)`] : []), ...reports.map(describeHintReport)];
  return { mode, unticked: open.length, units: units.length, plan: { tasks: [...seedTasks, review], notes } };
}

// ── preflight stages ──────────────────────────────────────────────────────────

const SCRATCH_KEY = "apply";
const analysisOf = (ctx: PreflightCtx): ApplyAnalysis => ctx.scratch[SCRATCH_KEY] as ApplyAnalysis;

/** The `openspec-apply` implementation (no registration: `apply.ts` registers it with the other apply parts). */
export function createApplyKindImpl(api: OpenspecApi): OpenspecKindImpl {
  const source = createTasksSource(api.inject, api.deps.clock);
  return {
    stages: {
      async resolve(ctx): Promise<Refusal | undefined> {
        const dir = resolveChangeDir(ctx.cwd, ctx.goal);
        if (!dir.ok) return { error: "change_unknown", message: `no OpenSpec change "${ctx.goal}" in this directory` };
        const rawFile = readBoundedFile(path.join(dir.dir, "tasks.md"));
        if (!rawFile.ok) return { error: "tasks_unreadable", message: "tasks.md could not be read", details: { detail: rawFile.code } };
        const read = await source.read(ctx.cwd, ctx.goal);
        if (!read.ok) return { error: "tasks_unreadable", message: "the task list could not be read", details: { detail: read.code, ...(read.status !== undefined ? { status: read.status } : {}) } };
        ctx.scratch[SCRATCH_KEY] = analyzeApply({ change: ctx.goal, tasks: read.tasks, raw: rawFile.text, maxTasks: ctx.maxTasks });
        return undefined;
      },
      skills: (ctx) => checkSkillStage(api, "review", ctx.config.reviewSkill, ctx.cwd),
      limits(ctx) {
        const a = analysisOf(ctx);
        return a.units > cap(ctx.maxTasks) ? { error: "too_many_tasks", message: `the change needs ${a.units} tasks; at most ${cap(ctx.maxTasks)} fit`, details: { tasks: a.units, max: cap(ctx.maxTasks) } } : undefined;
      },
      nothing: (ctx) => (analysisOf(ctx).unticked === 0 ? { error: "nothing_to_do", message: "every checkbox of this change is already ticked" } : undefined),
      in_use: (ctx) => (changesInUse(api, ctx.cwd).has(ctx.goal) ? { error: "change_in_use", message: "another active team already applies this change" } : undefined),
    },
    plan: (ctx) => analysisOf(ctx).plan,
  };
}
