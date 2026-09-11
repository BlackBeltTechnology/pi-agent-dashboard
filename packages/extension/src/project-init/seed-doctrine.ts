/**
 * DOX-doctrine seeding for the `project-init` skill.
 *
 * Doctrine is no longer copied into a project's `AGENTS.md`: the kb extension
 * (`pi-dashboard-kb-extension`) injects it into the system prompt per turn,
 * governed by the layered `doctrine` config group. The seed is therefore a
 * fixed marker + pointer block naming the extension and the project settings
 * file — no doctrine text, no drift (change: inject-dox-doctrine-and-describe).
 *
 * Marker-gated + idempotent: a target `AGENTS.md` that already carries the
 * `<!-- dox-doctrine -->` marker is left untouched.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Stable sentinel that marks an AGENTS.md as already carrying the pointer. */
export const DOX_MARKER = "<!-- dox-doctrine -->";

const POINTER_BLOCK = `${DOX_MARKER}

## DOX doctrine

Per-turn DOX doctrine — the kb-first READ discipline and the directory \`AGENTS.md\`
WRITE discipline — is injected by the \`pi-dashboard-kb-extension\`. Tune it in
\`.pi/dashboard/knowledge_base.json\` under the \`doctrine\` key (\`inject\`, \`write\`).
`;

/** The fixed pointer block (marker + pointer). Never contains doctrine text. */
export function buildDoctrineBlock(): string {
  return POINTER_BLOCK;
}

export interface SeedResult {
  /** True when the pointer was appended; false when it was already present. */
  seeded: boolean;
}

/**
 * Append the pointer block to `agentsMdPath` only when the file does not already
 * carry the marker. Idempotent: a present marker is a no-op. Creates the file
 * when absent.
 */
export function seedDoctrine(agentsMdPath: string): SeedResult {
  let existing = "";
  try {
    existing = fs.readFileSync(agentsMdPath, "utf8");
  } catch {
    existing = "";
  }
  if (existing.includes(DOX_MARKER)) return { seeded: false };

  const block = buildDoctrineBlock();
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const joiner = existing.length === 0 ? "" : "\n";
  fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
  fs.writeFileSync(agentsMdPath, `${existing}${sep}${joiner}${block}`, "utf8");
  return { seeded: true };
}
