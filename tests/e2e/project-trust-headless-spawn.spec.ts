import { expect, test } from "./fixtures.js";
import { ensureGitSession } from "./helpers/index.js";

/**
 * X4 / #F11 (harden-agent-tool-guards T.108) — headless RPC session in an untrusted cwd: no stall,
 * no auto-trust.
 *
 * A dashboard-spawned headless RPC session raised in a resource-bearing (`.pi/`), not-yet-trusted
 * cwd must reach ready/idle within the harness timeout WITHOUT the bridge answering `project_trust`
 * "yes": since harden-agent-tool-guards D3 the activation cwd is no longer trusted unconditionally,
 * the bridge withholds (`not-covered`) and pi applies `defaultProjectTrust`. Under the harness's
 * `ask` (no UI) pi skips the project's extensions without prompting or stalling — verified against
 * the installed pi by `packages/server/src/__tests__/pi-headless-trust-outcome.test.ts`. So the
 * session registers (card carries `data-session-id`) and the project extension marker is ABSENT.
 *
 * The decision logic (dashboard-trust-only matrix) is verified by the L1 unit suite
 * (`packages/extension/src/project-trust.test.ts`).
 *
 * INFRA GATE. The end-to-end proof needs a harness seam that (1) creates a temp cwd seeded with a
 * trust-requiring `.pi/` resource and (2) clears it from the container trust store so the untrusted
 * precondition holds. Until it lands this spec is opt-in via PI_TRUST_SEED_CWD — an absolute path
 * inside the container to an untrusted, `.pi/`-bearing dir. Optional PI_TRUST_SEED_MARKER: a path
 * the seeded project extension creates when it loads; asserted absent. Default run skips (no false red).
 */
test.describe("project_trust headless spawn: no auto-trust, no stall (L3)", () => {
  test("#F11 dashboard-spawned headless session in an untrusted .pi/ cwd registers and loads no project extension", async ({ page }) => {
    const seedCwd = process.env.PI_TRUST_SEED_CWD;
    test.skip(
      !seedCwd,
      "opt-in: set PI_TRUST_SEED_CWD to an untrusted, .pi/-bearing container path (trust-seed harness helper is a flagged follow-up)",
    );

    // A dashboard-spawned session must appear (bridge registers over /ws) and
    // reach a non-stalled state. A stall on the no-UI trust decision would
    // leave the card without ever becoming ready.
    const card = await ensureGitSession(page);
    await expect(card).toBeVisible({ timeout: 60_000 });
    // The card carries a data-session-id only once the bridge registered — the
    // observable proof that the headless session booted (was not blocked on
    // trust). A stalled session never registers.
    await expect
      .poll(async () => card.getAttribute("data-session-id"), { timeout: 60_000 })
      .toBeTruthy();

    // The project extension must NOT have loaded (no auto-trust). Only checkable with a marker seam.
    const marker = process.env.PI_TRUST_SEED_MARKER;
    if (marker) {
      const { execSync } = await import("node:child_process");
      const { DASHBOARD_PORT } = await import("./lifecycle.js");
      const name = execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
        .trim()
        .split("\n")[0];
      const present = execSync(`docker exec ${name} sh -c 'test -e "$0" && echo yes || echo no' ${marker}`, { encoding: "utf8" }).trim();
      expect(present, "project extension marker must be absent: the folder was not auto-trusted").toBe("no");
    }
  });
});
