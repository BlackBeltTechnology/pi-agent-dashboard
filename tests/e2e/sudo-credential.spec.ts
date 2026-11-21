/**
 * E2E: the sudo credential prompt through the real UI (change: add-sudo-credential-prompt,
 * test-plan #S58–#S64, tasks 1.2–1.8).
 *
 * A synthetic bridge (`helpers/sudo-credential-bridge.ts`, locally admitted inside the
 * container so the relay's trust gate admits it) emits `sudo_credential_request`; a real
 * browser answers. The bridge-side capture proves what the SERVER forwarded; the page-side
 * capture proves what the BROWSER sent (`_shown` is consumed by the relay and never reaches
 * the bridge, so "bridge receives `_shown`" in the test plan is observed on the page socket).
 *
 * S58 happy path + no leak       S59 Esc / Cancel          S60 two-tab race
 * S61 stale client (unanswerable) S62 connection loss       S63 bridge loss dismisses
 * S64 pending replay on reload
 *
 * Run (needs the docker harness; see the report in the change dir):
 *   PW_E2E_USE_RUNNING=1 npx playwright test tests/e2e/sudo-credential.spec.ts
 */

import { expect, type Page, test } from "./fixtures.js";
import { ensureFixturePinned, openComposerSession } from "./helpers/composer-bridge.js";
import { gotoDashboard } from "./helpers/index.js";
import {
  capturePageSudoFrames,
  connectSudoBridge,
  controlSocketOutage,
  dropSudoRequests,
  expectExactly,
  type SudoBridge,
  sudoDialog,
} from "./helpers/sudo-credential-bridge.js";

const PROMPT = "[sudo] password for u:";
const COMMANDS = ["sudo apt update"];

/** Land on the dashboard with the synthetic session selected (the page is then a relay subscriber). */
async function subscribe(page: Page, bridge: SudoBridge): Promise<void> {
  await openComposerSession(page, bridge.sessionId);
}

/** Selecting the session sends `subscribe`; the server adds the socket to the audience asynchronously. */
async function settleSubscription(page: Page): Promise<void> {
  await page.waitForTimeout(750);
}

async function setup(page: Page, tag: string): Promise<SudoBridge> {
  await gotoDashboard(page);
  await ensureFixturePinned(page);
  const bridge = await connectSudoBridge(page, tag);
  await subscribe(page, bridge);
  await settleSubscription(page);
  return bridge;
}

/** Everything a page persists in the browser that could carry a secret. */
async function persistedState(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      cookie: document.cookie,
      url: location.href,
    }),
  );
}

test.describe("sudo credential prompt (L3)", () => {
  test("S58: happy path — _shown then _response; dialog gone; the password is never in DOM, storage, URL, cookies or transcript", async ({ page }) => {
    const P = "hunter2-S58-secret";
    const frames = capturePageSudoFrames(page);
    // Sample every mutation after the submit click for the raw value (DOM text AND attributes).
    await page.addInitScript((value) => {
      const w = window as unknown as { __sudoArmed: boolean; __sudoLeak: boolean };
      w.__sudoArmed = false;
      w.__sudoLeak = false;
      const check = () => {
        if (!w.__sudoArmed || !document.documentElement) return;
        if (document.documentElement.outerHTML.includes(value) || document.body?.textContent?.includes(value)) w.__sudoLeak = true;
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    }, P);

    const bridge = await setup(page, "s58");
    try {
      const callId = bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      const ui = sudoDialog(page);
      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await expect(ui.commands).toContainText("sudo apt update");
      await expect(ui.promptText).toContainText(PROMPT);

      await ui.password.fill(P);
      await page.evaluate(() => { (window as unknown as { __sudoArmed: boolean }).__sudoArmed = true; });
      await ui.submit.click();

      await expect(ui.dialog).toHaveCount(0, { timeout: 10_000 });
      await expectExactly(() => bridge.frames("response").length, 1);
      const response = bridge.frames("response")[0];
      expect(response).toMatchObject({ callId, password: P, sessionId: bridge.sessionId });

      // The page acked (`_shown`) BEFORE it answered.
      const sent = frames.sent().filter((m) => m.callId === callId);
      const shown = sent.findIndex((m) => m.type === "sudo_credential_shown");
      const answered = sent.findIndex((m) => m.type === "sudo_credential_response");
      expect(shown, "the page acks the prompt").toBeGreaterThanOrEqual(0);
      expect(answered, "the page answers it").toBeGreaterThan(shown);

      expect(await page.evaluate(() => (window as unknown as { __sudoLeak: boolean }).__sudoLeak), "DOM sampled on every mutation").toBe(false);
      expect(await persistedState(page)).not.toContain(P);

      await page.reload();
      await subscribe(page, bridge);
      expect((await page.locator("body").textContent()) ?? "").not.toContain(P);
      expect(await persistedState(page)).not.toContain(P);
    } finally {
      bridge.close();
    }
  });

  test("S59: Esc and Cancel each send one _cancel, close the dialog and return focus to the composer", async ({ page }) => {
    const bridge = await setup(page, "s59");
    const ui = sudoDialog(page);
    const composer = page.getByTestId("composer-card").locator("textarea");
    try {
      // Run 1 — Esc, two commands.
      await composer.focus();
      bridge.emitRequest({ commands: ["sudo apt update", "sudo systemctl restart nginx"], prompt: PROMPT });
      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await expect(ui.commands.locator("pre")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(ui.dialog).toHaveCount(0, { timeout: 10_000 });
      await expectExactly(() => bridge.frames("cancel").length, 1);
      expect(bridge.frames("cancel")[0].reason, "operator Cancel is sticky: no reason").toBeUndefined();
      await expect(composer).toBeFocused();

      // Run 2 — the Cancel button.
      bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await ui.cancel.click();
      await expect(ui.dialog).toHaveCount(0, { timeout: 10_000 });
      await expectExactly(() => bridge.frames("cancel").length, 2);
      expect(bridge.frames("cancel")[1].reason).toBeUndefined();
      expect(bridge.frames("response")).toHaveLength(0);
      await expect(composer).toBeFocused();
    } finally {
      bridge.close();
    }
  });

  test("S60: two tabs submit in the same tick — exactly one _response reaches the bridge; neither password is stored", async ({ page }) => {
    const PA = "tab-A-secret-S60";
    const PB = "tab-B-secret-S60";
    const bridge = await setup(page, "s60");
    const page2 = await page.context().newPage();
    try {
      await gotoDashboard(page2);
      await subscribe(page2, bridge);

      bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      const a = sudoDialog(page);
      const b = sudoDialog(page2);
      await expect(a.dialog).toBeVisible({ timeout: 20_000 });
      await expect(b.dialog).toBeVisible({ timeout: 20_000 });
      await a.password.fill(PA);
      await b.password.fill(PB);

      // The first answer dismisses the other tab's dialog, so the loser's click may find it detached.
      await Promise.allSettled([a.submit.dispatchEvent("click"), b.submit.dispatchEvent("click")]);

      await expect(a.dialog).toHaveCount(0, { timeout: 10_000 });
      await expect(b.dialog).toHaveCount(0, { timeout: 10_000 });
      await expectExactly(() => bridge.frames("response").length, 1);
      expect([PA, PB]).toContain(bridge.frames("response")[0].password);

      for (const p of [page, page2]) {
        const state = await persistedState(p);
        expect(state).not.toContain(PA);
        expect(state).not.toContain(PB);
        expect(await p.locator("body").evaluate((el) => el.outerHTML)).not.toContain("secret-S60");
      }
    } finally {
      await page2.close();
      bridge.close();
    }
  });

  test("S61: a client that never renders the request is refused after ~2 s as unanswerable; the next request is not sticky", async ({ page }) => {
    const drop = await dropSudoRequests(page);
    const bridge = await setup(page, "s61");
    const ui = sudoDialog(page);
    try {
      bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      await expect.poll(() => bridge.frames("cancel").length, { timeout: 10_000 }).toBe(1);
      const cancel = bridge.frames("cancel")[0];
      expect(cancel.reason).toBe("unanswerable");
      const elapsed = cancel.at - bridge.lastRequestAt();
      expect(elapsed).toBeGreaterThanOrEqual(2000 - 250);
      expect(elapsed).toBeLessThanOrEqual(2000 + 250);
      await expect(ui.dialog).toHaveCount(0);

      // Non-sticky: un-drop, and the very next request gets a dialog.
      drop.setDropping(false);
      bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await ui.cancel.click();
      await expect(ui.dialog).toHaveCount(0, { timeout: 10_000 });
    } finally {
      bridge.close();
    }
  });

  test("S62: submit during a connection loss shows an error and sends nothing; after reconnect only a fresh submit answers", async ({ page }) => {
    const P = "typed-during-outage-S62";
    const outage = await controlSocketOutage(page);
    const frames = capturePageSudoFrames(page);
    const bridge = await setup(page, "s62");
    const ui = sudoDialog(page);
    try {
      bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await ui.password.fill(P.slice(0, 5)); // half-typed

      await outage.cut();
      await page.waitForTimeout(3_000);
      await ui.password.fill(P);
      const sentBefore = frames.sent().filter((m) => m.type === "sudo_credential_response").length;
      await ui.submit.click();
      await expect(ui.error).toContainText(/connection lost/i, { timeout: 10_000 });
      await expect(ui.dialog).toBeVisible();
      expect(frames.sent().filter((m) => m.type === "sudo_credential_response").length, "no frame sent during the outage").toBe(sentBefore);
      expect(bridge.frames("response")).toHaveLength(0);

      const requestsBefore = frames.received().filter((m) => m.type === "sudo_credential_request").length;
      await outage.restore();
      // The page reconnects by itself and the server replays the still-pending request: that
      // replayed frame is the observable "reconnected" signal. Nothing is answered on its own.
      await expect
        .poll(() => frames.received().filter((m) => m.type === "sudo_credential_request").length, { timeout: 30_000 })
        .toBeGreaterThan(requestsBefore);
      expect(bridge.frames("response"), "no _response until the user submits again").toHaveLength(0);
      expect(bridge.frames("cancel")).toHaveLength(0);

      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await ui.password.fill(P);
      await ui.submit.click();
      await expect(ui.dialog).toHaveCount(0, { timeout: 10_000 });
      await expectExactly(() => bridge.frames("response").length, 1);
      expect(bridge.frames("response")[0].password).toBe(P);
    } finally {
      await outage.restore();
      bridge.close();
    }
  });

  test("S63: losing the bridge dismisses the dialog on every page and clears the Forget chip; nothing is pending after it re-registers", async ({ page }) => {
    const bridge = await setup(page, "s63");
    const page2 = await page.context().newPage();
    let reborn: SudoBridge | undefined;
    try {
      await gotoDashboard(page2);
      await subscribe(page2, bridge);

      bridge.emitCache(Date.now() + 5 * 60_000);
      bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      for (const p of [page, page2]) {
        await expect(sudoDialog(p).dialog).toBeVisible({ timeout: 20_000 });
        await expect(sudoDialog(p).forget).toBeVisible({ timeout: 10_000 });
      }

      bridge.drop();
      for (const p of [page, page2]) {
        await expect(sudoDialog(p).dialog).toHaveCount(0, { timeout: 15_000 });
        await expect(sudoDialog(p).forget).toHaveCount(0, { timeout: 15_000 });
      }

      // Re-register under the same id: the old request must not come back.
      reborn = await connectSudoBridge(page, "s63", { sessionId: bridge.sessionId });
      await page.reload();
      await subscribe(page, reborn);
      await page.waitForTimeout(1_500);
      await expect(sudoDialog(page).dialog).toHaveCount(0);
      await expect(sudoDialog(page).forget).toHaveCount(0);
    } finally {
      await page2.close();
      reborn?.close();
      bridge.close();
    }
  });

  test("S64: a browser reload replays the pending request — empty field, new _shown, one _response, no 120 s wait", async ({ page }) => {
    const P = "after-reload-S64";
    const frames = capturePageSudoFrames(page);
    const bridge = await setup(page, "s64");
    const ui = sudoDialog(page);
    try {
      const callId = bridge.emitRequest({ commands: COMMANDS, prompt: PROMPT });
      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await ui.password.fill("half-typed");
      const shownBefore = frames.sent().filter((m) => m.type === "sudo_credential_shown" && m.callId === callId).length;
      const receivedBefore = frames.received().filter((m) => m.type === "sudo_credential_request" && m.callId === callId).length;

      // The reloaded page restores its selected session and re-subscribes by itself; the replayed
      // request's modal overlay would block a manual card click, so none is made here.
      await page.reload();

      await expect(ui.dialog).toBeVisible({ timeout: 20_000 });
      await expect(ui.password).toHaveValue("");
      await expect(ui.commands).toContainText("sudo apt update");
      await expect(ui.promptText).toContainText(PROMPT);

      const replayed = frames.received().filter((m) => m.type === "sudo_credential_request" && m.callId === callId);
      expect(replayed.length, "the server replays the pending request to the re-subscribed page").toBeGreaterThan(receivedBefore);
      expect(replayed.at(-1)).toMatchObject({ commands: COMMANDS, prompt: PROMPT });
      expect(replayed.at(-1)).not.toHaveProperty("password");
      expect(
        frames.sent().filter((m) => m.type === "sudo_credential_shown" && m.callId === callId).length,
        "the reloaded page acks again",
      ).toBeGreaterThan(shownBefore);

      const t0 = Date.now();
      await ui.password.fill(P);
      await ui.submit.click();
      await expect(ui.dialog).toHaveCount(0, { timeout: 10_000 });
      await expectExactly(() => bridge.frames("response").length, 1);
      expect(bridge.frames("response")[0]).toMatchObject({ callId, password: P });
      expect(bridge.frames("response")[0].at - t0, "answered long before the 120 s timeout").toBeLessThan(30_000);
    } finally {
      bridge.close();
    }
  });
});
