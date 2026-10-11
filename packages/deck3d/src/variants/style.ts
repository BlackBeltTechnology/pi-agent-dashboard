/**
 * `style.json` — types, validation and atomic I/O (spec deck3d-variant-loop
 * "style.json grammar and validation"). Every finding names its JSON path.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Ajv, { type ErrorObject } from "ajv";
import { formatPath, validateOverridesFragment } from "../ir/validate.js";
import { pkgRoot } from "../util/paths.js";

export interface Variant {
  name: string;
  label: string;
  overrides: Record<string, unknown>;
}

export interface Step {
  id: string;
  title: string;
  question: string;
  slides: string[];
  round: number;
  variants: Variant[];
  picked?: string | null;
  note?: string;
  pickedAt?: string;
  pending?: boolean;
  drop?: string[];
  replaceStep?: string;
}

export interface Style {
  version: 1;
  source?: string;
  steps: Step[];
}

export interface StyleIssue {
  path: string;
  message: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(JSON.parse(readFileSync(join(pkgRoot(), "src", "variants", "schema.json"), "utf8")) as object);

function message(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "minItems":
      return `needs at least ${String(p.limit)} entries`;
    case "maxItems":
      return `allows at most ${String(p.limit)} entries`;
    case "additionalProperties":
      return `unknown key '${String(p.additionalProperty)}'`;
    case "required":
      return `missing required key '${String(p.missingProperty)}'`;
    case "type":
      return `expected ${String(p.type)}`;
    case "pattern":
      return `must match ${String(p.pattern)}`;
    default:
      return e.message ?? e.keyword;
  }
}

export const STYLE_FILE = "style.json";

/** Validate a parsed `style.json`; `slideIds` (when known) turns dangling samples into warnings. */
export function validateStyle(style: unknown, slideIds?: Set<string>): { errors: StyleIssue[]; warnings: StyleIssue[] } {
  const errors: StyleIssue[] = [];
  const warnings: StyleIssue[] = [];
  if (!check(style)) {
    for (const e of check.errors ?? []) errors.push({ path: formatPath(e.instancePath), message: message(e) });
    return { errors, warnings };
  }
  const s = style as Style;
  s.steps.forEach((step, i) => {
    const names = new Set<string>();
    step.variants.forEach((v, j) => {
      if (names.has(v.name)) errors.push({ path: `steps[${i}].variants[${j}].name`, message: `duplicate variant name '${v.name}'` });
      names.add(v.name);
      for (const issue of validateOverridesFragment(v.overrides)) {
        errors.push({ path: `steps[${i}].variants[${j}].overrides${issue.path === "(root)" ? "" : `.${issue.path}`}`, message: issue.message });
      }
    });
    if (typeof step.picked === "string" && !names.has(step.picked)) {
      errors.push({ path: `steps[${i}].picked`, message: `'${step.picked}' names no variant (one of ${[...names].join(", ")})` });
    }
    if (slideIds) {
      for (const id of step.slides) {
        if (!slideIds.has(id)) warnings.push({ path: `steps[${i}].slides`, message: `sample slide '${id}' is not in the deck (skipped)` });
      }
    }
  });
  const ids = new Set<string>();
  s.steps.forEach((step, i) => {
    if (ids.has(step.id)) errors.push({ path: `steps[${i}].id`, message: `duplicate step id '${step.id}'` });
    ids.add(step.id);
  });
  return { errors, warnings };
}

export function stylePath(deckDir: string): string {
  return join(deckDir, STYLE_FILE);
}

export function readStyle(path: string): Style | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as Style;
}

/** Write via a temp file + rename, so a reader never sees a half-written file. */
export function writeAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export const serialize = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

/** First step with `pending: true` (an interrupted pick), if any. */
export function pendingStep(style: Style): Step | undefined {
  return style.steps.find((s) => s.pending === true);
}

export function interruptedMessage(step: Step): string {
  const name = step.picked ?? step.variants[0]?.name ?? "<variant>";
  return `an earlier pick of step '${step.id}' was interrupted (style.json has pending: true); re-run: deck3d variants pick ${step.id} ${name}`;
}
