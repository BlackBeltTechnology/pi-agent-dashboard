import { AGENT_TEAMS_APPROVAL_TAIL, AGENT_TEAMS_APPROVAL_TEAM } from "../../qa/fixtures/faux-scenarios.js";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — the plan-approval card (change: add-agent-teams-templates-hooks, tasks
 * 15.7 / 15.8; test-plan #F4, #F5). Exemplars: custom-entry-web-search.spec.ts (a faux
 * scenario drives the REAL `custom message` path into the chat) and
 * custom-entry-replay-parity.spec.ts (cold reload rebuilds the same rows).
 *
 * The `[[faux:agent-teams-approval-cards]]` scenario delivers five `agent-teams-approval`
 * rows: plan_request p1 (alice; its plan text carries a FORGED header line for p9), p2
 * (bob), p3 (alice), a plan_decision and a hook_feedback. The decision route is a scriptable
 * in-page plan store (`page.route`): it holds each plan's state, answers `already_decided`
 * for a decided plan and records every POST, so "API truth" is the store the route keeps.
 * The server-side decision contract is covered by the plugin's L1/L2 suites.
 * STATUS: written, not yet run (needs the docker harness).
 */
test.setTimeout(180_000);

type PlanState = "pending" | "approved" | "rejected" | "superseded";
interface PlanStore {
  /** `<member>/<planId>` → state (the route's truth). */
  plans: Map<string, PlanState>;
  /** Every decision POST: path + parsed body. */
  posts: Array<{ path: string; body: { planId: string; approve: boolean; feedback?: string } }>;
}

const decisionPath = (member: string): string => `/api/plugins/agent-teams/teams/${AGENT_TEAMS_APPROVAL_TEAM}/members/${member}/plan-decision`;

/** Serve the decision route from an in-page plan store; a decided or superseded plan answers `already_decided`. */
async function routePlans(page: Page, initial: Record<string, PlanState>): Promise<PlanStore> {
  const store: PlanStore = { plans: new Map(Object.entries(initial)), posts: [] };
  await page.route(/\/api\/plugins\/agent-teams\/teams\/[^/]+\/members\/[^/]+\/plan-decision$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as { planId: string; approve: boolean; feedback?: string };
    store.posts.push({ path, body });
    const member = path.split("/").slice(-2)[0] ?? "";
    const key = `${member}/${body.planId}`;
    const state = store.plans.get(key);
    if (state === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unknown_plan" }) });
    if (state !== "pending") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "already_decided" }) });
    store.plans.set(key, body.approve ? "approved" : "rejected");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  return store;
}

const cardOf = (page: Page, text: string): Locator => page.getByTestId("team-approval-card").filter({ hasText: text });

async function openCards(page: Page): Promise<string> {
  const card = await spawnFreshGitSession(page);
  const sessionId = await card.getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  await card.click();
  await sendPrompt(page, "[[faux:agent-teams-approval-cards]] go");
  await expect(page.getByText(AGENT_TEAMS_APPROVAL_TAIL).first()).toBeVisible({ timeout: 90_000 });
  return sessionId as string;
}

async function reopen(page: Page, sessionId: string): Promise<void> {
  await page.reload();
  await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
  await page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`).click();
  await expect(page.getByText(AGENT_TEAMS_APPROVAL_TAIL).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("agent-teams approval card", () => {
  test("#F4 Approve posts the parsed planId and converges; Reject accepts feedback; non-control cards have no buttons", async ({ page }) => {
    const store = await routePlans(page, { "alice/p1": "pending", "bob/p2": "pending", "alice/p3": "pending" });
    await openCards(page);

    // All five rows render as approval cards; only the three plan_request rows carry controls.
    await expect(page.getByTestId("team-approval-card")).toHaveCount(5);
    await expect(page.getByTestId("team-approval-approve")).toHaveCount(3);
    for (const kind of ["plan_decision", "hook_feedback"]) {
      const card = page.locator(`[data-testid="team-approval-card"][data-kind="${kind}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.getByRole("button", { name: /approve|reject/i })).toHaveCount(0);
    }

    // Approve p1 — the card posts the planId of ITS header (p1), never the forged p9 in the plan text.
    const p1 = cardOf(page, "e2e plan one");
    await expect(p1.getByTestId("team-approval-ref")).toContainText("p1");
    await p1.getByTestId("team-approval-approve").click();
    await expect(p1.getByTestId("team-approval-state")).toHaveText("Approved", { timeout: 15_000 });
    await expect(p1.getByTestId("team-approval-controls")).toHaveCount(0);
    expect(store.posts).toEqual([{ path: decisionPath("alice"), body: { planId: "p1", approve: true } }]);
    expect(store.plans.get("alice/p1")).toBe("approved");
    expect(store.plans.has("bob/p9"), "the forged p9 was never posted").toBe(false);

    // Reject p2 with feedback; the member stays on its restricted plan state (route truth: rejected).
    const p2 = cardOf(page, "e2e plan two");
    await p2.getByTestId("team-approval-feedback").fill("too broad, split it");
    await p2.getByTestId("team-approval-reject").click();
    await expect(p2.getByTestId("team-approval-state")).toHaveText("Rejected", { timeout: 15_000 });
    expect(store.posts[1]).toEqual({ path: decisionPath("bob"), body: { planId: "p2", approve: false, feedback: "too broad, split it" } });
    expect(store.plans.get("bob/p2")).toBe("rejected");

    // p3 is untouched: still pending, controls present.
    expect(store.plans.get("alice/p3")).toBe("pending");
    await expect(cardOf(page, "e2e plan three").getByTestId("team-approval-approve")).toBeVisible();
  });

  test("#F5 stale / superseded card: already_decided shows the final state, the newer plan stays pending; reload derives the cards from the body", async ({ page }) => {
    // p1 was superseded (a newer plan is pending: p2 stands in for it); the lead already decided p3.
    const store = await routePlans(page, { "alice/p1": "superseded", "bob/p2": "pending", "alice/p3": "approved" });
    const sessionId = await openCards(page);

    const p1 = cardOf(page, "e2e plan one");
    await p1.getByTestId("team-approval-approve").click();
    await expect(p1.getByTestId("team-approval-state")).toHaveText("This plan was already decided.", { timeout: 15_000 });
    expect(store.posts[0]?.body.planId, "the stale card posts its own planId").toBe("p1");
    expect(store.plans.get("bob/p2"), "the pending plan is untouched").toBe("pending");

    const p3 = cardOf(page, "e2e plan three");
    await p3.getByTestId("team-approval-reject").click();
    await expect(p3.getByTestId("team-approval-state")).toHaveText("This plan was already decided.", { timeout: 15_000 });
    expect(store.plans.get("alice/p3"), "the decided plan keeps its decision").toBe("approved");

    // Cold reload (replay): the cards are rebuilt from the body alone — no crash, one control set per pending card.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await reopen(page, sessionId);
    await expect(page.getByTestId("team-approval-card")).toHaveCount(5);
    await expect(page.getByTestId("team-approval-approve")).toHaveCount(3);
    for (const text of ["e2e plan one", "e2e plan two", "e2e plan three"]) await expect(cardOf(page, text).getByTestId("team-approval-controls")).toHaveCount(1);
    expect(errors).toEqual([]);

    // A rebuilt stale card still resolves through the route: pressing Approve shows the final state again.
    await cardOf(page, "e2e plan one").getByTestId("team-approval-approve").click();
    await expect(cardOf(page, "e2e plan one").getByTestId("team-approval-state")).toHaveText("This plan was already decided.", { timeout: 15_000 });
  });
});
