import { expect, test } from "@playwright/test";
import { ensureGitSession } from "./helpers/index.js";

/**
 * X4 (test-plan #X4) — headless RPC session auto-trust, no stall.
 *
 * A dashboard-spawned headless RPC session raised in a resource-bearing
 * (`.pi/`), not-yet-trusted cwd must reach ready/idle within the harness
 * timeout: the bridge's `project_trust` handler auto-decides "trust" for the
 * activation cwd (change: adopt-pi-074-080-features, A.3), so pi loads project
 * resources and the session never stalls on an unanswered no-UI trust prompt.
 *
 * The full decision logic (deny-by-default 8-row matrix, throw-defers, the
 * pre-session_start activation-cwd guard) is verified by the L1 unit suite
 * (`packages/extension/src/__tests__/project-trust.test.ts`).
 *
 * INFRA GATE. The end-to-end proof needs a harness seam that (1) creates a temp
 * cwd seeded with a trust-requiring `.pi/` resource and (2) clears it from the
 * container trust store so the untrusted precondition holds. That seam is a
 * flagged, non-blocking follow-up (test-plan "New infra needed"). Until it
 * lands this spec is opt-in via PI_TRUST_SEED_CWD — an absolute path inside the
 * container to an untrusted, `.pi/`-bearing dir — mirroring the opt-in variants
 * in anthropic-bridge-activation.spec.ts. Default run skips (no false red).
 */
test.describe("project_trust headless auto-trust (L3)", () => {
  test("dashboard-spawned headless session in an untrusted .pi/ cwd reaches idle", async ({ page }) => {
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
  });
});
