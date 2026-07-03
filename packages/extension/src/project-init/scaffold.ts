/**
 * Scaffold a chosen profile into a target directory.
 *
 * Writes, from the profile bundle:
 *   <dir>/AGENTS.md            ← AGENTS.md.tmpl  ({{PROJECT_NAME}} substituted)
 *   <dir>/.pi/settings.json    ← settings.json.tmpl  (worktreeInit hook + toolset)
 *   <dir>/.pi/prompts/*.md     ← prompts/*.md
 * and, when the profile opts into DOX:
 *   appends the doctrine block to <dir>/AGENTS.md (marker-gated, idempotent)
 *   writes <dir>/.pi/dashboard/knowledge_base.json (directory-level AGENTS.md toolset)
 *
 * Writing `worktreeInit` flips the directory to "configured": the next
 * Initialize click hits change-A's `hasHook: true` path.
 *
 * Idempotency: `planScaffold` reports which target files already exist so the
 * interactive skill can ask before overwriting; `scaffoldProfile` overwrites
 * only when `overwrite: true`.
 *
 * See change: project-init-skill-and-profiles.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { writeDoxKbConfig } from "./dox-kb-config.js";
import type { Profile } from "./profiles.js";
import { seedDoctrine } from "./seed-doctrine.js";

export interface ScaffoldOptions {
  profile: Profile;
  targetDir: string;
  /** Substituted for `{{PROJECT_NAME}}` in AGENTS.md.tmpl. Defaults to the dir basename. */
  projectName?: string;
  /**
   * Extra `{{KEY}}` → value substitutions applied to every rendered template
   * (e.g. the stack fills `INSTALL_CMD` / `INIT_GATE` from `detect-stack.ts`).
   * `PROJECT_NAME` is always merged in. See change: project-init-skill-and-profiles.
   */
  substitutions?: Record<string, string>;
  /** Whether the kb toolset is wired (selects the doctrine READ variant). Defaults to profile.dox. */
  kbWired?: boolean;
  /** Overwrite existing files. Default false (throws on conflict). */
  overwrite?: boolean;
}

export interface ScaffoldPlan {
  /** Absolute paths the scaffold will write. */
  writes: string[];
  /** Subset of `writes` that already exist on disk (would be overwritten). */
  conflicts: string[];
  /** True when the profile opts into DOX (doctrine seed + kb toolset). */
  dox: boolean;
}

/**
 * Substitute every `{{KEY}}` for which a value is supplied. Unknown keys are
 * left as-is. `escape` transforms each substituted value — used to JSON-escape
 * values rendered into a JSON template so a command/name containing `"` or `\`
 * cannot corrupt the output.
 */
function render(
  tmpl: string,
  subs: Record<string, string>,
  escape: (v: string) => string = (v) => v,
): string {
  return tmpl.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) =>
    Object.hasOwn(subs, key) ? escape(subs[key]!) : whole,
  );
}

/** Escape a value for safe interpolation inside a JSON string literal. */
const jsonEscape = (v: string): string => JSON.stringify(v).slice(1, -1);

/** Unresolved `{{KEY}}` placeholders remaining in rendered text. */
function leftoverPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]!);
}

/**
 * Structural validity check for a `worktreeInit` hook, mirroring change-A's
 * `normalizeHook` (packages/server/src/worktree-init.ts). Returns true when the
 * hook would be accepted (non-empty gate + a valid script|agent run); false
 * when change-A would fail-open to `null`.
 */
export function isValidWorktreeInit(hook: unknown): boolean {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return false;
  const h = hook as { gate?: unknown; run?: unknown };
  if (typeof h.gate !== "string" || h.gate.length === 0) return false;
  if (!h.run || typeof h.run !== "object" || Array.isArray(h.run)) return false;
  const run = h.run as { type?: unknown; command?: unknown; prompt?: unknown };
  if (run.type === "script") return typeof run.command === "string" && run.command.length > 0;
  if (run.type === "agent") return typeof run.prompt === "string" && run.prompt.length > 0;
  return false;
}

function listPrompts(profileDir: string): string[] {
  const dir = path.join(profileDir, "prompts");
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

/** Enumerate the files a scaffold would write + which already exist. */
export function planScaffold(opts: ScaffoldOptions): ScaffoldPlan {
  const { profile, targetDir } = opts;
  const writes = [
    path.join(targetDir, "AGENTS.md"),
    path.join(targetDir, ".pi", "settings.json"),
    ...listPrompts(profile.dir).map((f) => path.join(targetDir, ".pi", "prompts", f)),
  ];
  if (profile.dox) {
    writes.push(path.join(targetDir, ".pi", "dashboard", "knowledge_base.json"));
  }
  const conflicts = writes.filter((p) => fs.existsSync(p));
  return { writes, conflicts, dox: profile.dox };
}

export interface ScaffoldResult extends ScaffoldPlan {
  /** True when the DOX doctrine was appended (false = already present or not dox). */
  doctrineSeeded: boolean;
  /** True when the worktreeInit hook rendered is structurally valid. */
  hookValid: boolean;
  /** `{{KEY}}` placeholders left unfilled across the written templates (should be empty). */
  leftover: string[];
}

/**
 * Perform the scaffold. Throws when a target file exists and `overwrite` is
 * false (the interactive skill previews `planScaffold().conflicts` first).
 */
export function scaffoldProfile(opts: ScaffoldOptions): ScaffoldResult {
  const { profile, targetDir } = opts;
  const projectName = opts.projectName ?? path.basename(targetDir);
  const overwrite = opts.overwrite ?? false;
  const kbWired = opts.kbWired ?? profile.dox;
  const subs = { PROJECT_NAME: projectName, ...(opts.substitutions ?? {}) };
  const leftover: string[] = [];

  const plan = planScaffold(opts);
  if (!overwrite && plan.conflicts.length > 0) {
    throw new Error(`refusing to overwrite existing files: ${plan.conflicts.join(", ")}`);
  }

  // AGENTS.md
  const agentsMd = path.join(targetDir, "AGENTS.md");
  const agentsTmpl = fs.readFileSync(path.join(profile.dir, "AGENTS.md.tmpl"), "utf8");
  const agentsText = render(agentsTmpl, subs);
  leftover.push(...leftoverPlaceholders(agentsText));
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(agentsMd, agentsText, "utf8");

  // .pi/settings.json. Substitutions are JSON-escaped so a stack command or
  // project name containing `"`/`\` cannot corrupt the file; the rendered text
  // is validated as JSON BEFORE writing so corruption surfaces as a thrown
  // error rather than a silently-broken settings file.
  const settingsRaw = fs.readFileSync(path.join(profile.dir, "settings.json.tmpl"), "utf8");
  const settingsText = render(settingsRaw, subs, jsonEscape);
  leftover.push(...leftoverPlaceholders(settingsText));
  let parsedSettings: { worktreeInit?: unknown };
  try {
    parsedSettings = JSON.parse(settingsText) as { worktreeInit?: unknown };
  } catch (err) {
    throw new Error(
      `rendered .pi/settings.json is not valid JSON (check the profile template + substitutions): ${(err as Error).message}`,
    );
  }
  const settingsDir = path.join(targetDir, ".pi");
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, "settings.json"), settingsText, "utf8");
  const hookValid = isValidWorktreeInit(parsedSettings.worktreeInit);

  // prompts/*.md
  const prompts = listPrompts(profile.dir);
  if (prompts.length > 0) {
    const promptsDir = path.join(targetDir, ".pi", "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    for (const f of prompts) {
      fs.copyFileSync(path.join(profile.dir, "prompts", f), path.join(promptsDir, f));
    }
  }

  // DOX: seed doctrine + kb toolset.
  let doctrineSeeded = false;
  if (profile.dox) {
    doctrineSeeded = seedDoctrine(agentsMd, { kbWired }).seeded;
    // Honor overwrite for the kb config too, so the plan/conflict UX (which
    // lists knowledge_base.json as a conflict) matches actual write behavior.
    writeDoxKbConfig(targetDir, { overwrite });
  }

  return { ...plan, doctrineSeeded, hookValid, leftover };
}
