import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, sendPrompt } from "./helpers/index.js";

/**
 * Rendered-UI convergence for the OpenSpec auto-attach locality gate
 * (change: scope-openspec-auto-attach-to-session-cwd, test-plan F2).
 *
 * Drives the REAL detection path: a faux-scripted bash tool call forwarded by
 * the bridge as `tool_execution_start`, through the server gate, out to the
 * card. Session state is read from the dashboard's own same-origin REST
 * (localhost-gated, same authentication as the app's own calls) because
 * `attachedProposal` has no dedicated card testid — the assertion is on
 * CONVERGENCE of the rendered state, not on an internal event.
 *
 * Test-plan F1 (the rejection NOTICE) is deliberately NOT an L3 row: a notify
 * chat row is rendered only from the live `notify` WS message
 * (`useMessageHandler` → `addNotify`) and the client never hydrates
 * `notifyLog` from the session list, so a rejection that fires before the chat
 * subscription settles is invisible by construction. Its invariants (exactly
 * one `info` entry per name, no busy state, session stays reapable) are
 * asserted at L1 by `packages/server/src/__tests__/auto-attach-locality.test.ts`
 * (X1, X2, X6).
 */

interface SessionShape {
  id: string;
  name?: string;
  attachedProposal?: string | null;
  openspecChange?: string | null;
  status?: string;
  notifyLog?: Array<{ notifyId: string; message: string; level?: string }>;
}

async function readSession(page: Page, id: string): Promise<SessionShape | undefined> {
  return page.evaluate(async (sessionId) => {
    const res = await fetch("/api/sessions");
    const body = await res.json();
    const list = (body?.data ?? body?.sessions ?? []) as SessionShape[];
    return list.find((s) => s.id === sessionId);
  }, id);
}

test.describe("OpenSpec auto-attach locality gate", () => {
  test("F2: an openspec command targeting another repo leaves the card unattached and unrenamed", async ({ page }) => {
    const card = await ensureGitSession(page);
    const id = await card.getAttribute("data-session-id");
    expect(id, "session card must carry a session id").toBeTruthy();
    // Select the card so the composer belongs to THIS session.
    await card.click();

    await sendPrompt(page, "[[faux:openspec-foreign-cd]] go");

    // Converge: the run finishes and the card never picks up the foreign change.
    await expect
      .poll(async () => (await readSession(page, id as string))?.status, { timeout: 90_000 })
      .not.toBe("running");

    const session = await readSession(page, id as string);
    expect(session?.attachedProposal ?? null).toBeNull();
    expect(session?.openspecChange ?? null).toBeNull();
    expect(session?.name ?? "").not.toBe("repo-b-change");
    await expect(card).not.toContainText("repo-b-change");
    // D3 dropped the evidence before the gate, so there is nothing to report.
    expect((session?.notifyLog ?? []).filter((n) => n.message.includes("repo-b-change")).length).toBe(0);
  });
});
