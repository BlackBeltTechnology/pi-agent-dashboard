/**
 * F1 fixture: a stub pi extension that leaks a skill into every spawned session
 * through `resources_discover` — the same vector operator-level extensions use,
 * which `--no-skills` does not stop (design D10 spike). Installed into the
 * instance HOME's user extensions dir; the team guard's `before_agent_start`
 * filter must remove the leaked skill from the provider-bound prompt.
 * See change: add-team-skill-access.
 */
import fs from "node:fs";
import path from "node:path";

/** Write a user-dir extension advertising `skillMd` as a discovered skill. */
export function installLeakyExtension(home: string, skillMd: string): void {
  const dir = path.join(home, ".pi", "agent", "extensions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "team-e2e-leak.ts"),
    `export default function (pi: { on(event: string, handler: () => unknown): void }) { pi.on("resources_discover", () => ({ skillPaths: [${JSON.stringify(skillMd)}] })); }\n`,
  );
}
