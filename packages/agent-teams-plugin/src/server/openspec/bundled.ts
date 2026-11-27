/**
 * The `bundled` template source (design D1): the `*.md` files of the package `templates/` directory are
 * registered through core's `registerBundledTemplate` (listed after `project` and `user`, so a same-named
 * project/user template shadows them; trusted, no hook trust prompt). The directory is resolved from the
 * module URL (`<pkg>/src/server/openspec/` → `<pkg>/templates`), which holds from source (jiti/tsx), a built
 * layout and an unpacked tarball (`files` ships `templates/`). `examples/` is never scanned.
 * Shipped code is still checked: a bundled template must pin `mode: session` and declare no `TaskCreated`
 * hook, else it is skipped with one error log.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTemplate } from "../template-parse.js";
import { registerBundledTemplate } from "../templates.js";
import type { Logger } from "../types.js";

const MAX_BUNDLED_BYTES = 64 * 1024;

/** `<package>/templates` for a module living at `<package>/src/server/openspec/`, or undefined when absent. */
export function resolveTemplatesDir(moduleUrl: string = import.meta.url): string | undefined {
  const dir = path.resolve(fileURLToPath(new URL("../../../templates/", moduleUrl)));
  try {
    return fs.statSync(dir).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

/** Bundled template names found in `dir` (`*.md`, no dotfiles, regular files only), sorted. */
export function listBundledFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
      .map((e) => e.name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/** Why a bundled template is not acceptable, or `undefined`. */
export function bundledTemplateProblem(text: string, stem: string): string | undefined {
  const out = parseTemplate(text, stem);
  if (!out.core) return `invalid: ${out.errors.map((e) => e.code).join(",")}`;
  if (out.core.declaredMode !== "session") return "mode must be session";
  if ((out.core.hooks?.TaskCreated?.length ?? 0) > 0) return "must not declare a TaskCreated hook";
  return undefined;
}

/** Register every acceptable bundled template of `dir`; returns the registered names and one disposer. */
export function registerBundledTemplates(dir: string | undefined, logger: Logger): { names: string[]; dispose(): void } {
  const disposers: Array<() => void> = [];
  const names: string[] = [];
  if (dir) {
    for (const stem of listBundledFiles(dir)) {
      let text: string;
      try {
        const file = path.join(dir, `${stem}.md`);
        if (fs.statSync(file).size > MAX_BUNDLED_BYTES) throw new Error("too large");
        text = fs.readFileSync(file, "utf8");
      } catch (err) {
        logger.error(`agent-teams: bundled template ${stem} is unreadable: ${(err as Error).message}`);
        continue;
      }
      const problem = bundledTemplateProblem(text, stem);
      if (problem) {
        logger.error(`agent-teams: bundled template ${stem} is not registered (${problem})`);
        continue;
      }
      disposers.push(registerBundledTemplate(stem, text));
      names.push(stem);
    }
  }
  return { names, dispose: () => disposers.splice(0).forEach((d) => d()) };
}
