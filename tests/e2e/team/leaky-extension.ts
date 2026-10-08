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

/**
 * Static extension source (no interpolation → no code construction from data). The skill path travels
 * in a JSON sidecar next to the extension, read from the instance HOME at `resources_discover` time.
 */
const EXTENSION_SOURCE = `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export default function (pi: { on(event: string, handler: () => unknown): void }) {
  pi.on("resources_discover", () => {
    const sidecar = path.join(os.homedir(), ".pi", "agent", "extensions", "team-e2e-leak.json");
    return { skillPaths: [JSON.parse(fs.readFileSync(sidecar, "utf8")).skillMd] };
  });
}
`;

/** Write a user-dir extension advertising `skillMd` as a discovered skill. */
export function installLeakyExtension(home: string, skillMd: string): void {
  const dir = path.join(home, ".pi", "agent", "extensions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "team-e2e-leak.json"), JSON.stringify({ skillMd }));
  fs.writeFileSync(path.join(dir, "team-e2e-leak.ts"), EXTENSION_SOURCE);
}
