/**
 * Regression-prevention lint: forbid the `env: { ...process.env }` anti-pattern
 * in `packages/server/src/cli.ts`.
 *
 * Why this is forbidden:
 *
 * `launchDashboardServer` (the shared spawn primitive) internally computes the
 * spawn env as `ToolResolver.buildSpawnEnv(process.env)`, which augments PATH
 * with managed-dir, bundled-node, and pi-bin prepends. Caller-supplied `env`
 * is then overlaid on top with caller-wins semantics.
 *
 * Passing `env: { ...process.env }` re-supplies the raw, un-augmented PATH
 * back over the augmented base, silently defeating the entire purpose of
 * `buildSpawnEnv` — the spawned daemon then cannot find `pi` (or any other
 * tool resolved via PATH augmentation) in environments where the launching
 * shell's PATH lacks those prepends (e.g. `.desktop` launchers, systemd-user
 * units, non-interactive logins that don't init nvm).
 *
 * See: openspec/changes/fix-cli-env-clobber/proposal.md
 * See: dashboard-server capability spec — constraint C22 (env merge contract)
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_SOURCE = path.resolve(__dirname, "..", "cli.ts");

describe("cli.ts env clobber lint", () => {
  it("does not pass `env: { ...process.env }` to launchDashboardServer", () => {
    const source = fs.readFileSync(CLI_SOURCE, "utf8");
    const pattern = /env:\s*\{\s*\.\.\.process\.env\s*\}/;
    const match = source.match(pattern);

    expect(
      match,
      "packages/server/src/cli.ts must not contain `env: { ...process.env }`. " +
        "This pattern clobbers the augmented PATH from ToolResolver.buildSpawnEnv. " +
        "Omit `env` to let the shared primitive's resolver-merged env take effect. " +
        "See openspec/changes/fix-cli-env-clobber/proposal.md.",
    ).toBeNull();
  });
});
