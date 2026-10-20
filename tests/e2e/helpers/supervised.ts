/**
 * Shared helpers for the Supervised-mode (tool approval) L3 specs.
 * See change: add-supervised-tool-approval (test-plan F1–F10, F14–F23).
 *
 * Every helper drives the REAL UI (composer chip, approval card) against the faux model;
 * SETUP that has no UI affordance (config, display prefs) goes through the same-origin REST.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { BASE_URL } from "../lifecycle.js";
import { FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./index.js";

/** Approval card (pending) / resolved row. Testids shipped by `ToolApprovalCard`. */
export const approvalCard = (page: Page): Locator => page.getByTestId("tool-approval-card");
export const resolvedRow = (page: Page): Locator => page.getByTestId("tool-approval-resolved");
export const allowOnceBtn = (page: Page): Locator => page.getByTestId("tool-approval-approve");
export const denyBtn = (page: Page): Locator => page.getByTestId("tool-approval-deny");
export const decisionRows = (page: Page): Locator => page.getByTestId("supervised-decision-row");

export const SUPERVISED_BASH_TAIL = "supervised bash done";

/** Close the OpenSpec Propose dialog a card click may leave open (its backdrop eats clicks). */
export async function dismissProposeDialog(page: Page): Promise<void> {
  const overlay = page.getByTestId("propose-dialog-overlay");
  for (let i = 0; i < 3; i++) {
    if (!(await overlay.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
}

/** Show tool rows + their bodies, so a tool result / block reason is rendered text. */
export async function enableToolSurfaces(page: Page): Promise<void> {
  const res = await page.request.patch("/api/preferences/display", {
    data: { toolResults: true, toolResultBodies: true, toolCalls: { read: true, bash: true, edit: true, agent: true, generic: true } },
  });
  expect(res.ok()).toBeTruthy();
}

/** Send one command on the browser socket (the channel the app itself uses). */
export async function browserCommand(payload: Record<string, unknown>): Promise<void> {
  const socket = new WebSocket(`${BASE_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket open timeout")), 15_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("socket error")); }, { once: true });
  });
  socket.send(JSON.stringify(payload));
  await new Promise((r) => setTimeout(r, 500));
  socket.close();
}

/**
 * Pin the baked git fixture over the browser socket when it is not pinned yet.
 *
 * The add-folders dialog (`pinDirectory`) lists through `/api/browse`, which is confined to
 * `$HOME` + pinned dirs, so on a harness without `PI_DASHBOARD_PIN_DIRS` it can never reach
 * `/fixtures/sample-git` ("path outside allowed roots"). The `pin_directory` command is not
 * browse-confined, so pin directly and let `spawnFreshGitSession` find the group.
 */
export async function ensureFixturePinned(page: Page): Promise<void> {
  const pinned = async (): Promise<string[]> =>
    ((await (await page.request.get("/api/pinned-dirs")).json()) as { data?: string[] }).data ?? [];
  if ((await pinned()).includes(FIXTURE_GIT)) return;
  await browserCommand({ type: "pin_directory", path: FIXTURE_GIT });
  await expect.poll(pinned, { timeout: 15_000 }).toContain(FIXTURE_GIT);
  await page.reload();
}

/** Spawn a fresh faux session, select it, and wait until its composer can send. */
export async function openFreshSession(page: Page): Promise<{ card: Locator; sessionId: string }> {
  await ensureFixturePinned(page);
  const card = await spawnFreshGitSession(page);
  const sessionId = (await card.getAttribute("data-session-id")) ?? "";
  expect(sessionId).toBeTruthy();
  await card.click();
  await dismissProposeDialog(page);
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  return { card, sessionId };
}

/**
 * Flip the composer mode control and wait for the server round trip (the chip's `data-mode`
 * follows `session.supervised`, which only changes once the bridge applied the flip).
 * Uses the settings-row chip when the composer is wide, else the ⋯ overflow radio group.
 */
export async function setMode(page: Page, on: boolean): Promise<void> {
  const want = on ? "supervised" : "full";
  const chip = page.getByTestId("session-mode-chip");
  if (await chip.isVisible().catch(() => false)) {
    if ((await chip.getAttribute("data-mode")) === want) return;
    await chip.click();
    await page.getByTestId(`session-mode-option-${want}`).click();
  } else {
    const trigger = page.getByTestId("overflow-button");
    await trigger.click();
    await page.getByTestId(`overflow-mode-${want}`).click();
    await trigger.click(); // the menu stays open after a pick and would cover the send button
    await expect(page.getByTestId("overflow-menu")).toHaveCount(0);
  }
  await expect
    .poll(async () => page.getByTestId("session-mode-chip").getAttribute("data-mode"), { timeout: 15_000 })
    .toBe(want);
}

/** Fresh session already in Supervised mode. */
export async function openSupervisedSession(page: Page): Promise<{ card: Locator; sessionId: string }> {
  const s = await openFreshSession(page);
  await setMode(page, true);
  return s;
}

/** Run a faux scenario in the open session. */
export async function runScenario(page: Page, scenario: string): Promise<void> {
  await sendPrompt(page, `[[faux:${scenario}]] go`);
}

/** Wait for the pending approval card and return it. */
export async function expectPendingCard(page: Page, timeout = 30_000): Promise<Locator> {
  const card = approvalCard(page).first();
  await expect(card).toBeVisible({ timeout });
  return card;
}

/** The transcript text (tool rows included). */
export const transcript = (page: Page): Locator => page.getByTestId("chat-scroll-container");

/** `m:ss` from the card's `Denies in m:ss` countdown, in seconds. */
export async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId("tool-approval-clock").first().innerText()).trim();
  const m = /(\d+):(\d{2})/.exec(text);
  expect(m, `countdown text "${text}"`).toBeTruthy();
  return Number(m![1]) * 60 + Number(m![2]);
}

/** Read a config value through the same-origin REST. */
export async function getConfig<T = Record<string, unknown>>(page: Page): Promise<T> {
  const res = await page.request.get("/api/config");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data?: T } & T;
  return (body.data ?? body) as T;
}

/** `PUT /api/config` partial; throws a readable error on refusal. */
export async function putConfig(page: Page, partial: Record<string, unknown>): Promise<void> {
  const res = await page.request.put("/api/config", { data: partial });
  expect(res.ok(), `PUT /api/config ${JSON.stringify(partial)} → ${res.status()}`).toBe(true);
}

/** The server's session record (`awaitingToolApproval`, `supervised`, …). */
export async function readSession(page: Page, sessionId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await (await page.request.get("/api/sessions")).json()) as { data: Array<Record<string, unknown>> };
    return body.data.find((s) => s.id === sessionId);
  } catch {
    return undefined; // server mid-restart: callers poll until it answers
  }
}

/** Select a session's card in the sidebar (after a reload / respawn the client drops the selection). */
export async function selectSession(page: Page, sessionId: string): Promise<void> {
  const card = page.locator(`[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`);
  await card.waitFor({ state: "visible", timeout: 60_000 });
  await card.click();
  await dismissProposeDialog(page);
}

// ── Agent path-gate glue (F15–F18; mirrors `agent-path-gate.spec.ts`) ───────────────────────────

/** Revoke any persisted grant for the out-of-root fixture dir (isolates grant-dependent specs). */
export async function revokeFixtureGrants(page: Page): Promise<void> {
  await page.goto("/settings/access");
  const rows = page.getByTestId("access-entry").filter({ hasText: "/srv/fixtures-outside" });
  await page.getByTestId("access-section").waitFor({ timeout: 15_000 });
  await page.getByTestId("access-entry").first().or(page.getByTestId("access-empty-state")).waitFor({ timeout: 15_000 });
  for (let i = 0; i < 5 && (await rows.count()) > 0; i++) {
    await rows.first().getByTestId("access-revoke").click();
    await expect(rows).toHaveCount(0, { timeout: 10_000 }).catch(() => undefined);
  }
}

/** Forget remembered agent-path refusals (a gate Deny is remembered across sessions). */
export async function clearAgentRefusals(page: Page): Promise<void> {
  const view = (await (await page.request.get("/api/access/prompts")).json()) as {
    data: { refusals: Array<{ plane: string; subject: string }> };
  };
  for (const r of view.data.refusals.filter((x) => x.plane === "agent-path")) {
    await page.request.delete(`/api/access/refusals?plane=agent-path&subject=${encodeURIComponent(r.subject)}`);
  }
}

export const startUnscopedYolo = (page: Page) =>
  page.request.post("/api/access/yolo", { data: { durationMinutes: 15, base: "/tmp", unscoped: true } });
export const endYolo = (page: Page) => page.request.delete("/api/access/yolo").catch(() => undefined);

// ── Tool-row reveal (rows are collapsed by default: burst → step → body) ─────────────────────────

/**
 * Wait for the live tool burst to settle (header no longer "Working"), then expand the burst and
 * every step so each tool's result body (output / block reason) is rendered text. Call ONCE per
 * state: the clicks toggle.
 */
export async function revealToolBodies(page: Page): Promise<void> {
  const t = transcript(page);
  await expect(t.getByText("Working", { exact: true })).toHaveCount(0, { timeout: 30_000 });
  // A decision row between two tool calls splits them into SEPARATE bursts: expand every one.
  const groups = t.getByTestId("tool-burst-group");
  const bursts = await groups.count();
  for (let b = 0; b < bursts; b++) {
    const group = groups.nth(b);
    if ((await group.getByTestId("tool-burst-body").count()) === 0) await group.getByTestId("tool-burst-header").first().click();
    const steps = group.getByTestId("tool-burst-body").locator("button");
    const n = await steps.count();
    for (let i = 0; i < n; i++) await steps.nth(i).click();
  }
}
