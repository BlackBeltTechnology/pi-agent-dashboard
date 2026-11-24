import { expect, test } from "./fixtures.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * L3 — agent-teams core against the docker harness (change: add-agent-teams-core,
 * test-plan rows S133, S134).
 *
 * SKELETON (task 1.15): the rendered UI in this change is minimal (the team UI
 * arrives in change 2), so L3 stays at two rows. Both need a scripted faux
 * LEAD session that calls `TeamCreate` + `TeammateSpawn` — added with the
 * runtime sections of the change; until then both are `test.fixme` (reported as
 * skipped, not green).
 *
 * Port is derived (`BASE_URL`), never hardcoded. Harness lifecycle:
 *   docker/test-up.sh -d --build && PW_E2E_USE_RUNNING=1 npm run test:e2e -- agent-teams-core
 */

test.describe("agent-teams core (L3)", () => {
  test.fixme("S133 teammate session visible as an ordinary session card", async () => {
    // GIVEN a faux-scripted lead calls TeamCreate + TeammateSpawn(alice)
    // WHEN the dashboard is open and the user types in alice's session
    // THEN alice is an openable session card (name/cwd shown), the message makes
    //      her `busy` in GET /api/plugins/agent-teams/teams/:id and she gets no
    //      auto-claimed task while the user is mid-conversation.
    expect(BASE_URL).toBeTruthy();
  });

  test.fixme("S134 orphan/restart card state converges after a server restart", async () => {
    // GIVEN a live lead + teammate session
    // WHEN the server restarts
    // THEN the card state converges (members re-bound by hello, no duplicate teammate cards).
    expect(BASE_URL).toBeTruthy();
  });
});
