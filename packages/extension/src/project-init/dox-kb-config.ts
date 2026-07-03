/**
 * kb-config fragment written when scaffolding a DOX-opted profile.
 *
 * The directory-level AGENTS.md toolset lives in the kb config
 * (`.pi/dashboard/knowledge_base.json`), not `.pi/settings.json`. A DOX-opted
 * scaffold writes this fragment so the seeded doctrine is backed by the
 * existing `kb dox` tooling: `indexAgentsFiles` indexes AGENTS.md files and
 * `directoryLevelAgents.enabled` powers `kb agents <path>` chain-walks.
 *
 * A single `.` filesystem source covers the whole project so the seeded root
 * doctrine (and any per-directory tree the agent builds later) is indexed.
 *
 * Validated against the kb config schema in the unit test.
 *
 * See change: project-init-skill-and-profiles.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** kb-config object enabling the directory-level AGENTS.md toolset. */
export const DOX_KB_CONFIG = {
  sources: [{ kind: "filesystem" as const, ref: "." }],
  indexAgentsFiles: true,
  directoryLevelAgents: { enabled: true },
};

/** Absolute path to a project's kb config file. */
export function kbConfigPath(dir: string): string {
  return path.join(dir, ".pi", "dashboard", "knowledge_base.json");
}

/**
 * Write the DOX kb config into `<dir>/.pi/dashboard/knowledge_base.json`.
 * Idempotent by default: an existing config is left untouched (the user/project
 * owns it). Pass `overwrite: true` to rewrite it — the scaffold does so when the
 * caller confirmed overwriting, so the plan/conflict UX matches actual writes.
 */
export function writeDoxKbConfig(
  dir: string,
  opts: { overwrite?: boolean } = {},
): { written: boolean } {
  const target = kbConfigPath(dir);
  if (!opts.overwrite && fs.existsSync(target)) return { written: false };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(DOX_KB_CONFIG, null, 2)}\n`, "utf8");
  return { written: true };
}
