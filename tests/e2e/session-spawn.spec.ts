import { test, expect } from "@playwright/test";
import { ensureGitSession } from "./helpers/index.js";

// Scenario 5.1 (design.md "scenario B") — the AUTHORITATIVE WS round-trip.
//
// The smoke spec only proves the browser reaches the container and the shell
// renders (negative-hold on the disconnect banner). It deliberately does NOT
// prove a live WS round-trip, because no positive "connected" DOM element
// exists.
//
// A session card (`session-card-desktop`) only renders after the dashboard
// spawns a real `pi` process whose bridge connects back over `/ws` and
// registers the session. So pinning a baked fixture and spawning a session —
// the card appearing — IS the proof that the browser<->server<->bridge WS path
// is live end-to-end. The pin + spawn flow lives in `ensureGitSession()`
// (helpers/index.ts); this spec asserts its result.
//
// Harness preconditions (set by PI_E2E_SEED=1 in global-setup.ts): the
// onboarding gate is cleared (fake provider credential) and the in-container
// browser can reach the directory-listing endpoint (network guard opened).
test.describe("session spawn (WS round-trip)", () => {
  test("pin git fixture, spawn a session, card appears", async ({ page }) => {
    const card = await ensureGitSession(page);
    await expect(card).toBeVisible();
  });
});
