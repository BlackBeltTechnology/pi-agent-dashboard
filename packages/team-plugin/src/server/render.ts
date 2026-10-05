/**
 * Persona rendering (D6): persona.md outside every target + project context
 * file collection. See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteText } from "./text-write.js";
import { canonicalize, isInside } from "./paths.js";
import type { Persona } from "./types.js";

/** pi's cwd anchor; persona text must not be able to move the bridge's splice point. */
const ANCHOR = "\nCurrent working directory: ";
const ZWJ = "\u200d";
const CONTEXT_FILE_MAX_BYTES = 64 * 1024;

function neutraliseAnchor(text: string): string {
  return text.split(ANCHOR).join(`\n${ZWJ}${ANCHOR.slice(1)}`);
}

function renderPersonaMarkdown(persona: Pick<Persona, "name" | "description" | "role" | "instructions">): string {
  const header = `# ${persona.name}${persona.role === "leader" ? " (leader)" : ""}`;
  const desc = persona.description ? `\n\n${persona.description}` : "";
  return neutraliseAnchor(`${header}${desc}\n\n${persona.instructions}\n`);
}

/** Render to `<runtimeDir>/persona.md` and return its path. */
export function writePersonaFile(runtimeDir: string, persona: Persona): string {
  const file = path.join(runtimeDir, "persona.md");
  atomicWriteText(file, renderPersonaMarkdown(persona));
  return file;
}

/** Project root `AGENTS.md` / `CLAUDE.md`: regular files resolving inside the root, ≤ 64 KiB. */
export function collectContextFiles(root: string): string[] {
  const out: string[] = [];
  const realRoot = canonicalize(root);
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const candidate = path.join(realRoot, name);
    try {
      const real = fs.realpathSync(candidate);
      if (!isInside(realRoot, real)) continue;
      const st = fs.statSync(real);
      if (!st.isFile() || st.size > CONTEXT_FILE_MAX_BYTES) continue;
      out.push(real);
    } catch {
      /* absent */
    }
  }
  return out;
}
