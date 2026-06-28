/**
 * Expand prompt templates from disk for slash commands sent via the dashboard.
 *
 * pi.sendUserMessage() calls session.prompt() with expandPromptTemplates: false,
 * which skips prompt template and skill expansion. This module provides a workaround
 * by reading template/skill files directly and expanding them.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { buildSkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

/**
 * Scan directories for .md prompt template files.
 *
 * Resolution path (in precedence order, consumed by resolveTemplate):
 *   1. `<cwd>/.pi/prompts/*.md`        — flat prompt templates, keyed by basename.
 *   2. `<cwd>/.pi/skills/<skill>/SKILL.md` — keyed `skill:<skill>`.
 *   3. `<cwd>/.pi/skills/<skill>/commands/*.md` — skill-bundled slash commands,
 *      keyed by basename (e.g. `dashboard-server-health`). Scanned directly
 *      because pi.getCommands() does not reliably surface nested skill command
 *      files across pi versions. See change: add-dashboard-slash-commands.
 *   4. pi.getCommands() registry (skills + global/project/package prompt
 *      templates) — consulted as a fallback in resolveTemplate via sourceInfo.path.
 *      `loadPromptTemplate` additionally harvests each registry skill's
 *      `commands/*.md` (via `addSkillCommandsFromRegistry`) so bundled commands
 *      resolve when cwd is not the extension install dir.
 */
function findPromptTemplates(cwd: string): Map<string, string> {
  const templates = new Map<string, string>();
  const dirs = [
    join(cwd, ".pi", "prompts"),
    join(cwd, ".pi", "skills"),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      scanDir(dir, templates);
    } catch { /* ignore */ }
  }
  return templates;
}

function scanDir(dir: string, templates: Map<string, string>): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        // Check for SKILL.md inside directory
        const skillFile = join(fullPath, "SKILL.md");
        if (existsSync(skillFile)) {
          templates.set(`skill:${entry}`, skillFile);
        }
        // Skill-bundled slash commands live in `<skill>/commands/*.md`.
        // pi.getCommands() does not reliably surface these nested files
        // across pi versions, so scan them directly (exactly one level
        // into `commands/`). Each file is keyed by its basename so
        // `/dashboard:server-health` resolves `dashboard-server-health.md`.
        // See change: add-dashboard-slash-commands.
        scanCommandsSubdir(join(fullPath, "commands"), templates);
      } else if (entry.endsWith(".md")) {
        const name = entry.replace(/\.md$/, "");
        templates.set(name, fullPath);
      }
    } catch { /* ignore */ }
  }
}

/**
 * Harvest skill-bundled `commands/*.md` from `pi.getCommands()` so they resolve
 * regardless of the session's cwd. End-user / Docker sessions run with cwd set
 * to the user's project (NOT the extension install dir), so the cwd scan never
 * sees the bundled skill. `pi.getCommands()` surfaces each skill dir via
 * `sourceInfo.path` (its SKILL.md); we scan that dir's sibling `commands/`.
 * Keyed by basename; does not clobber a cwd-local template of the same name.
 * See change: add-dashboard-slash-commands.
 */
function addSkillCommandsFromRegistry(pi: any | undefined, templates: Map<string, string>): void {
  if (!pi?.getCommands) return;
  try {
    const cmds = pi.getCommands();
    if (!Array.isArray(cmds)) return;
    for (const c of cmds) {
      if (c?.source !== "skill") continue;
      const p = c?.sourceInfo?.path ?? c?.path;
      if (typeof p !== "string" || p.length === 0) continue;
      // `p` points at the skill's SKILL.md (or its dir). Derive the dir.
      const skillDir = p.endsWith(".md") ? dirname(p) : p;
      scanCommandsSubdir(join(skillDir, "commands"), templates);
    }
  } catch { /* ignore */ }
}

/** Scan a skill's `commands/` subdir (one level) for `.md` templates. */
function scanCommandsSubdir(commandsDir: string, templates: Map<string, string>): void {
  if (!existsSync(commandsDir)) return;
  try {
    for (const entry of readdirSync(commandsDir)) {
      if (!entry.endsWith(".md")) continue;
      const fullPath = join(commandsDir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch { continue; }
      const name = entry.replace(/\.md$/, "");
      // Do not clobber a top-level prompt/skill of the same name.
      if (!templates.has(name)) templates.set(name, fullPath);
    }
  } catch { /* ignore */ }
}

/**
 * Typed frontmatter recognised on prompt templates. Only these three keys are
 * interpreted; every other key is ignored for forward compatibility so future
 * fields (e.g. `format:`, `priority:`) never break older bridges.
 * See change: add-dashboard-slash-commands.
 */
export interface PromptFrontmatter {
  /** Opt-in executable mode. v1 supports only the literal "bash". */
  executable?: "bash";
  /** When true, output is NOT appended to LLM context (mirrors `!!`). */
  excludeFromContext?: boolean;
  /** Cosmetic description (autocomplete tooltip — not used in v1). */
  description?: string;
}

/**
 * Parse a YAML-lite frontmatter block (line-oriented `key: value`, no nesting,
 * no lists). Unknown keys are ignored. Malformed lines (no colon) are skipped
 * rather than throwing. `executable` accepts only the literal "bash"; any other
 * value is dropped (template degrades to LLM mode).
 * See change: add-dashboard-slash-commands.
 */
function parseFrontmatterBlock(block: string): PromptFrontmatter {
  const fm: PromptFrontmatter = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue; // key without colon → ignore (forward-compat)
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    switch (key) {
      case "executable":
        if (value === "bash") fm.executable = "bash";
        // Unsupported values (node, python, …) intentionally ignored → LLM mode.
        break;
      case "excludeFromContext":
        if (value === "true") fm.excludeFromContext = true;
        else if (value === "false") fm.excludeFromContext = false;
        break;
      case "description":
        fm.description = value;
        break;
      // Unknown keys ignored (forward compat).
    }
  }
  return fm;
}

/**
 * Read template content, parsing YAML frontmatter into a typed object and
 * returning the body separately. An unclosed / absent frontmatter block yields
 * empty frontmatter and the whole content as body (graceful fall-back to LLM).
 */
function readTemplate(filePath: string): { frontmatter: PromptFrontmatter; body: string } {
  const content = readFileSync(filePath, "utf-8");
  // Capture both the frontmatter block (group 1) and the body (group 2).
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match) {
    return { frontmatter: parseFrontmatterBlock(match[1]), body: match[2].trim() };
  }
  return { frontmatter: {}, body: content.trim() };
}

/**
 * Build the deduped, ordered list of candidate names for `:` ↔ `-` alias resolution.
 * Original form always comes first, preserving the user's typed punctuation as
 * authoritative intent (see design Decision 4: original-form-first precedence).
 */
function candidateNames(name: string): string[] {
  const variants = new Set<string>();
  variants.add(name);
  if (name.includes(":")) variants.add(name.replace(/:/g, "-"));
  if (name.includes("-")) variants.add(name.replace(/-/g, ":"));
  return [...variants];
}

type Resolution = {
  filePath: string;
  source: "prompt" | "skill";
  resolvedName: string;
};

/**
 * Resolve `templateName` against (a) local prompt/skill scan and (b) pi.getCommands().
 *
 * Probe order is OUTER-loop over candidate-name variants, INNER probe over the
 * three stores. This guarantees original-form-first precedence: every store is
 * consulted on the typed form before any remapped variant is consulted on any
 * store. See design Decision 4.
 */
function resolveTemplate(
  templateName: string,
  templates: Map<string, string>,
  pi: any | undefined,
): Resolution | null {
  for (const cand of candidateNames(templateName)) {
    // Step 1: local-scan prompt/skill key (may be `skill:<dir>` for SKILL.md dirs).
    const local = templates.get(cand);
    if (local) {
      return {
        filePath: local,
        source: cand.startsWith("skill:") ? "skill" : "prompt",
        resolvedName: cand,
      };
    }
    // Step 2: local SKILL.md directory keyed as `skill:<cand>`.
    const localSkill = templates.get(`skill:${cand}`);
    if (localSkill) {
      return { filePath: localSkill, source: "skill", resolvedName: cand };
    }
    // Step 3: pi.getCommands() registry skill / prompt template.
    if (pi?.getCommands) {
      try {
        const commandsRaw = pi.getCommands();
        const commands = Array.isArray(commandsRaw) ? commandsRaw : [];
        // pi's getCommands() carries the on-disk path under `sourceInfo.path`
        // (synthetic SourceInfo: { path, source, scope, origin, baseDir }).
        // Older builds / unit stubs use a top-level `path`. Accept both.
        // Guard the type: a malformed entry with a non-string path must not
        // throw in existsSync (which would abort the loop and shadow an
        // otherwise-resolvable entry). See change:
        // resolve-global-prompt-templates-from-dashboard.
        const cmdPath = (c: any): string | undefined => {
          const p = c?.sourceInfo?.path ?? c?.path;
          return typeof p === "string" && p.length > 0 ? p : undefined;
        };
        const skill = commands.find(
          (c: any) => c.name === cand && c.source === "skill" && cmdPath(c),
        );
        const skillPath = skill && cmdPath(skill);
        if (skillPath && existsSync(skillPath)) {
          return { filePath: skillPath, source: "skill", resolvedName: cand };
        }
        // Global/project/package prompt templates register as source: "prompt".
        // pi.getCommands() already carries their absolute path — no fs scan added.
        // Probed inside the same candidate loop so original-form-first precedence holds.
        const prompt = commands.find(
          (c: any) => c.name === cand && c.source === "prompt" && cmdPath(c),
        );
        const promptPath = prompt && cmdPath(prompt);
        if (promptPath && existsSync(promptPath)) {
          return { filePath: promptPath, source: "prompt", resolvedName: cand };
        }
      } catch { /* ignore */ }
    }
  }
  return null;
}

/**
 * Assemble the LLM-bound text for a resolved template: skill templates get the
 * skill-block wrapper, plain prompt templates append args after a blank line.
 */
function assembleLlmText(resolution: Resolution, body: string, argsString: string): string {
  if (resolution.source === "skill") {
    // Strip leading `skill:` prefix (only present for local-scan step-1 hits
    // whose key was `skill:<dir>`); registry hits and step-2 hits already
    // hold the bare name.
    const bareName = resolution.resolvedName.replace(/^skill:/, "");
    return buildSkillBlock({
      name: bareName,
      filePath: resolution.filePath,
      baseDir: dirname(resolution.filePath),
      body,
      userArgs: argsString || undefined,
    });
  }
  // Plain prompt templates: append args after a blank line, no wrapper.
  if (argsString) return `${body}\n\n${argsString}`;
  return body;
}

/**
 * Discriminated result of resolving a slash command to a prompt template.
 *   - `llm`:  expand to user-message text and route through the LLM (default).
 *   - `exec`: run the body as bash and skip the LLM entirely (`executable: bash`).
 * `null` when no template matched the typed slash command.
 * See change: add-dashboard-slash-commands.
 */
export type LoadedPromptTemplate =
  | { kind: "llm"; text: string }
  | { kind: "exec"; body: string; excludeFromContext: boolean; argsString: string };

/**
 * Resolve a slash command to its template and classify it as LLM-bound or
 * executable. Templates carrying `executable: bash` frontmatter resolve to
 * `kind: "exec"`; everything else (including unsupported `executable:` values)
 * resolves to `kind: "llm"`. Returns `null` when no template matched.
 *
 * Resolution path: local `.pi/prompts` + `.pi/skills` scan first, then
 * `pi.getCommands()` (which already carries skill/prompt template paths under
 * `sourceInfo.path`). See change: add-dashboard-slash-commands.
 *
 * @param pi Optional pi extension API — used to find globally installed skills
 *           and package skills via pi.getCommands() when local scan misses them.
 */
export function loadPromptTemplate(text: string, cwd: string, pi?: any): LoadedPromptTemplate | null {
  if (!text.startsWith("/")) return null;

  // Split template name from args on first whitespace (space OR newline).
  // Using indexOf(" ") alone breaks multi-line payloads like "/skill:foo\nargs"
  // because the first space can lie inside the args, producing a name such as
  // "skill:foo\nargs-first-word" that never matches a template.
  const m = text.slice(1).match(/^(\S+)\s*([\s\S]*)$/);
  const templateName = m?.[1] ?? text.slice(1);
  const argsString = m?.[2] ?? "";

  const templates = findPromptTemplates(cwd);
  // Also harvest skill-bundled commands/*.md from the registry so /dashboard:*
  // resolves when cwd is not the extension install dir (real / Docker sessions).
  addSkillCommandsFromRegistry(pi, templates);
  const resolution = resolveTemplate(templateName, templates, pi);
  if (!resolution) return null;

  try {
    const { frontmatter, body } = readTemplate(resolution.filePath);
    if (frontmatter.executable === "bash") {
      // Default to !!-style context exclusion; authors opt back in with
      // `excludeFromContext: false` to capture output for follow-up reasoning.
      const excludeFromContext = frontmatter.excludeFromContext ?? true;
      return { kind: "exec", body, excludeFromContext, argsString };
    }
    return { kind: "llm", text: assembleLlmText(resolution, body, argsString) };
  } catch {
    return null;
  }
}

/**
 * Expand a slash command by finding and reading the prompt template from disk.
 * Returns the expanded text, or the original text if no template found.
 *
 * Backward-compat wrapper around `loadPromptTemplate`: always returns an
 * LLM-text string. Exec-mode templates (`executable: bash`) should be routed
 * via `loadPromptTemplate` by the dispatcher BEFORE reaching this function.
 * If one slips through here (e.g. the multi-line / image-bearing passthrough
 * path that calls this then `sendUserMessage`), the ORIGINAL `text` is returned
 * — never the raw bash body, which must not reach the LLM. See change:
 * add-dashboard-slash-commands (CodeRabbit: do not send exec bodies to the LLM).
 *
 * @param pi Optional pi extension API — used to find globally installed skills
 *           and package skills via pi.getCommands() when local scan misses them.
 */
export function expandPromptTemplateFromDisk(text: string, cwd: string, pi?: any): string {
  const loaded = loadPromptTemplate(text, cwd, pi);
  if (!loaded) return text;
  return loaded.kind === "exec" ? text : loaded.text;
}
