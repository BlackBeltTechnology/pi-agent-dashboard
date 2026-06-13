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

/** Scan directories for .md prompt template files */
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
      } else if (entry.endsWith(".md")) {
        const name = entry.replace(/\.md$/, "");
        templates.set(name, fullPath);
      }
    } catch { /* ignore */ }
  }
}

/** Read template content, stripping YAML frontmatter */
function readTemplate(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  // Strip YAML frontmatter (---\n...\n---)
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
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
 * Expand a slash command by finding and reading the prompt template from disk.
 * Returns the expanded text, or the original text if no template found.
 *
 * @param pi Optional pi extension API — used to find globally installed skills
 *           and package skills via pi.getCommands() when local scan misses them.
 */
export function expandPromptTemplateFromDisk(text: string, cwd: string, pi?: any): string {
  if (!text.startsWith("/")) return text;

  // Split template name from args on first whitespace (space OR newline).
  // Using indexOf(" ") alone breaks multi-line payloads like "/skill:foo\nargs"
  // because the first space can lie inside the args, producing a name such as
  // "skill:foo\nargs-first-word" that never matches a template.
  const m = text.slice(1).match(/^(\S+)\s*([\s\S]*)$/);
  const templateName = m?.[1] ?? text.slice(1);
  const argsString = m?.[2] ?? "";

  const templates = findPromptTemplates(cwd);
  const resolution = resolveTemplate(templateName, templates, pi);
  if (!resolution) return text;

  try {
    const content = readTemplate(resolution.filePath);

    if (resolution.source === "skill") {
      // Strip leading `skill:` prefix (only present for local-scan step-1 hits
      // whose key was `skill:<dir>`); registry hits and step-2 hits already
      // hold the bare name.
      const bareName = resolution.resolvedName.replace(/^skill:/, "");
      return buildSkillBlock({
        name: bareName,
        filePath: resolution.filePath,
        baseDir: dirname(resolution.filePath),
        body: content,
        userArgs: argsString || undefined,
      });
    }

    // Plain prompt templates: append args after a blank line, no wrapper.
    if (argsString) {
      return `${content}\n\n${argsString}`;
    }
    return content;
  } catch {
    return text;
  }
}
