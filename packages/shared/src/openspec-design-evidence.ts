/**
 * Local-evidence override for the OpenSpec `design` artifact.
 *
 * The upstream `spec-driven` schema requires `design.md` as a hard,
 * single-file dependency of `tasks`. Two real-world workflows fight that:
 *
 *   • **Split design** — users put design content in `design-rendering.md`
 *     + `design-state.md`. The CLI doesn't see them; status reports
 *     `design: ready` forever; dashboard shows `[Continue] [FF]` instead of
 *     `[Apply]`.
 *   • **No-design changes** — trivial fixes that don't need a design doc.
 *     User writes `tasks.md`, starts implementing; CLI still says
 *     `design: ready`; dashboard buttons are wrong.
 *
 * This module computes a boolean "is design satisfied locally?" from
 * file-system evidence the CLI ignores. It is consumed by:
 *
 *   1. `buildOpenSpecData` in `openspec-poller.ts` — promotes
 *      `artifacts[design].status` from "ready" to "done" when the rules fire.
 *      Promote-only; design-only; never demotes; never touches other artifacts.
 *
 *   2. `.pi/skills/openspec-shared/scripts/effective-status.sh` — the
 *      OpenSpec workflow skills invoke this wrapper instead of
 *      `openspec status --json` so skill-driven prompts and dashboard buttons
 *      cannot disagree.
 *
 * Three rules, evaluated in order with short-circuit:
 *
 *   R1  any file matching ^design.*\.md$ exists in the change folder
 *   R2  a design/ subdirectory exists with at least one *.md inside
 *   R3  tasks.md exists AND contains at least one Markdown checkbox
 *       (^\s*-\s+\[[ xX]\]\s)
 *
 * R3 is heuristic but defensible: a user who wrote actionable tasks has
 * already made the design decisions. The schema's hard dependency is
 * paperwork we don't believe in for trivial changes.
 *
 * See change: fix-openspec-design-detection.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Probe surface — kept tiny so unit tests can pass an in-memory stub. */
export interface DesignEvidenceProbe {
  /** R1: any file matching `^design.*\.md$` in `changeDir`. */
  hasDesignFile(changeDir: string): boolean;
  /** R2: `<changeDir>/design/` exists and contains at least one `*.md`. */
  hasDesignDirWithMd(changeDir: string): boolean;
  /** R3: `<changeDir>/tasks.md` contains at least one Markdown checkbox. */
  tasksHasCheckboxes(changeDir: string): boolean;
  /**
   * Optional: the change's schema name resolved locally from its
   * `.openspec.yaml` (fallback `openspec list` path, which carries no
   * `schemaName`). Undefined when there is no metadata.
   */
  localSchemaName?(changeDir: string): string | undefined;
}

/** Schema whose design artifact is authored, never inferred from local evidence. */
export const PI_SPEC_DRIVEN_SCHEMA = "pi-spec-driven";

/**
 * Pure rule evaluator. R1 → R2 → R3, short-circuits on first match.
 * `schemaName === "pi-spec-driven"` skips evidence entirely (no probe call).
 * See change: add-pi-spec-driven-schema.
 */
export function evaluateLocalDesignSatisfaction(
  changeDir: string,
  probe: DesignEvidenceProbe,
  schemaName?: string,
): boolean {
  if (schemaName === PI_SPEC_DRIVEN_SCHEMA) return false;
  if (probe.hasDesignFile(changeDir)) return true;
  if (probe.hasDesignDirWithMd(changeDir)) return true;
  if (probe.tasksHasCheckboxes(changeDir)) return true;
  return false;
}

const DESIGN_FILE_RE = /^design.*\.md$/;
const SCHEMA_LINE_RE = /^schema:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/m;
const CHECKBOX_RE = /^\s*-\s+\[[ xX]\]\s/m;

/** Production probe — backed by the real filesystem. Sync, defensive. */
export function createFsDesignEvidenceProbe(): DesignEvidenceProbe {
  return {
    hasDesignFile(changeDir) {
      try {
        const entries = readdirSync(changeDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && DESIGN_FILE_RE.test(e.name)) return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    hasDesignDirWithMd(changeDir) {
      const dir = path.join(changeDir, "design");
      try {
        const st = statSync(dir);
        if (!st.isDirectory()) return false;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith(".md")) return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    localSchemaName(changeDir) {
      try {
        return SCHEMA_LINE_RE.exec(readFileSync(path.join(changeDir, ".openspec.yaml"), "utf8"))?.[1];
      } catch {
        return undefined;
      }
    },

    tasksHasCheckboxes(changeDir) {
      const tasks = path.join(changeDir, "tasks.md");
      if (!existsSync(tasks)) return false;
      try {
        const text = readFileSync(tasks, "utf8");
        return CHECKBOX_RE.test(text);
      } catch {
        return false;
      }
    },
  };
}
