import { type APIRequestContext, expect, type Page, test } from "./fixtures.js";
import { startHiddenPiSession, stopHiddenPiSession } from "./helpers/hidden-session.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// Faux round-trip — interactive ask_user renderer.
//
// Sends `[[faux:ask-select]]`; the faux fixture streams an `ask_user` tool call
// (method `select`, options ["alpha","beta"]). The bridge surfaces it as an
// interactiveUi message → /ws → ChatView dispatches to SelectRenderer, which
// renders one clickable option button per choice. Asserting the "alpha" option
// button is visible proves the interactive select widget mounted end-to-end.
//
// Scenario args: qa/fixtures/faux-scenarios.ts → askScenario("select", { options }).

test.describe("faux round-trip — interactive ask_user", () => {
  test("select widget mounts for a faux ask_user tool call", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:ask-select]] go");

    // Ack-driven settlement, well below the 30s safety timeout, and never the
    // failed arm. See change: fix-optimistic-prompt-stuck-sending, test-plan #F2.
    // NOT asserted: the transient `sent` tick. The user `message_start` clears
    // the bubble entirely, and against the faux model that can land in the same
    // frame as the ack — asserting the tick would be racy. The composer gate is
    // the stable ack-settlement observable: it re-enables ONLY when the prompt
    // is no longer `sending`.
    await expect(page.getByTestId("pending-prompt-failed")).toHaveCount(0);
    await expect(page.getByPlaceholder(/message/i).first()).toBeEnabled({
      timeout: 15_000,
    });

    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("pending-prompt-failed")).toHaveCount(0);
  });
});

// Rendered-UI behaviour for prompt-derived `currentTool`.
//
// `currentTool` is derived from live pi events, and the original
// `tool_execution_start{ask_user}` is not a transcript entry — so it is never
// replayed. Before this change, any bridge re-register ended with a synthetic
// `agent_start` that cleared the field, and a session genuinely blocked on the
// user rendered "Thinking…" forever.
//
// See change: restore-ask-user-tool-state-on-reconnect, test-plan #F6, #F8.
test.describe("prompt-derived tool state — rendered card", () => {
  /** Drive a faux session until it is genuinely parked on an `ask_user` prompt. */
  async function parkOnAskUser(page: import("@playwright/test").Page) {
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:ask-select]] go");
    // The rendered option button proves the prompt is live and unanswered.
    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    return card;
  }

  /** `{ pid, startedAt }` identifying the current server process, or null while down. */
  async function serverIdentity(
    page: import("@playwright/test").Page,
  ): Promise<{ pid: number; startedAt: string } | null> {
    try {
      const res = await page.request.get("/api/health", { timeout: 5_000 });
      if (!res.ok()) return null;
      const body = (await res.json()) as { pid: number; startedAt: string };
      return body.pid == null ? null : { pid: body.pid, startedAt: body.startedAt };
    } catch {
      return null; // mid-restart: connection refused / empty response
    }
  }

  test("#F6 the card converges back to 'Needs you' after a dashboard server restart", async ({
    page,
  }) => {
    test.fixme(true, "https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/683"); // quarantine: see issue #683
    await gotoDashboard(page);

    // MUST be a session the dashboard did not spawn. `server.stop()` calls
    // `shutdownHeadlessProcesses()`, which SIGTERMs every dashboard-spawned pi
    // ("GONE and can never reattach"), so such a session cannot demonstrate a
    // reconnect — there would be nothing left to re-register. The harness
    // fixture (PI_E2E_INDEPENDENT_SESSION=1) launches a pi outside that
    // lifecycle, exactly like a TUI session a user started themselves.
    const listed = await page.request.get("/api/sessions");
    const { data } = (await listed.json()) as { data: Array<{ id: string; source: string }> };
    const independent = data.find((s) => s.source === "tui");
    test.skip(
      !independent,
      "needs the independent-pi fixture: PI_E2E_INDEPENDENT_SESSION=1 docker/test-up.sh",
    );

    const card = page.locator(
      `[data-testid="session-card-desktop"][data-session-id="${independent!.id}"]`,
    );
    await card.waitFor({ state: "visible", timeout: 30_000 });
    await card.click();

    // Park it on a real, unanswered prompt.
    await sendPrompt(page, "[[faux:ask-select]] go");
    await expect(
      page.getByRole("button", { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });

    const before = await serverIdentity(page);
    expect(before, "server identity must be readable before restart").not.toBeNull();

    // Restart the dashboard server only — the pi session (a separate process)
    // stays alive and its bridge re-registers, replaying history and ending
    // with the synthetic `agent_start` that used to destroy the state.
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
      // The server tears the socket down mid-response; a transport error here
      // is the expected shape of a successful restart request.
    });

    // Wait for a DIFFERENT server process. Without this the assertions below
    // race the restart and can pass against the pre-restart DOM — a vacuous
    // green that would not notice the bug this change exists to fix. It also
    // leaves the server healthy for the next test in the file.
    await expect
      .poll(async () => {
        const now = await serverIdentity(page);
        return now !== null && (now.pid !== before!.pid || now.startedAt !== before!.startedAt);
      }, { timeout: 120_000, intervals: [500] })
      .toBe(true);

    // Reload so the browser re-subscribes to the restarted server, then let the
    // bridge finish re-registering (register → prompt_request → replay_complete
    // → synthetic agent_start).
    await page.reload();

    // The SAME session must come back — proving it survived rather than being
    // replaced by a fresh spawn.
    await expect(card).toBeVisible({ timeout: 90_000 });
    // …blocked-on-you, not stuck on "Thinking…". This is the regression: the
    // reconnect ends with a synthetic `agent_start` that used to clear
    // `currentTool`, leaving a prompt-blocked session rendering as working.
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText("Thinking…")).toHaveCount(0);
  });

  test("#F8 answering the prompt clears the needs-you state", async ({ page }) => {
    const card = await parkOnAskUser(page);
    await expect(card.getByText("Needs you")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /alpha/i }).first().click();

    // The last prompt resolving clears `currentTool`, so the card must leave
    // the needs-you state — the clear path, not just the set path.
    await expect(card.getByText("Needs you")).toHaveCount(0, { timeout: 30_000 });
  });
});

// ── Pending-question stack (header pill → panel → dialog / navigation) ───────
//
// Browser reality for change: add-pending-question-stack — F2, F3, F7, P1 of its
// test-plan. REST bodies use the `{success, data}` envelope.
//
// Selectors (all existing app testids / roles — nothing added for E2E):
//   question-pill · question-panel (data-variant "dropdown" | "sheet") ·
//   question-row-<id> · question-dialog · question-later · [data-pending-ask]
//   (the pending inline ask card, ChatView) · composer-root.
//
// Hidden session: `helpers/hidden-session.ts` (a live pi with the bridge's
// explicit `PI_DASHBOARD_HIDDEN` visibility intent). The automation engine that
// would spawn a real hidden run is broken in the harness (#683), and the stack
// routes on the session's `hidden` flag — the same predicate a hidden
// automation run trips — so this exercises the identical dialog route.
//
// Brief: none of these scenarios depends on one (no `@fast` model in the
// harness); the dialog's inputs are enabled while a brief is still `pending`.
// The deterministic-brief scenario is X5 in pending-prompt-recovery.spec.ts.

interface QuestionRowDto {
  id: string;
  sessionId: string;
  briefStatus: string;
}

/** Open question rows (`GET /api/questions` → `{success, data: QuestionRow[]}`). */
async function listQuestions(request: APIRequestContext): Promise<QuestionRowDto[]> {
  const res = await request.get("/api/questions");
  expect(res.ok(), `GET /api/questions → ${res.status()}`).toBe(true);
  return ((await res.json()) as { success: boolean; data: QuestionRowDto[] }).data;
}

/** Wait for `sessionId` to hold an open question; return its opaque id. */
async function waitForQuestionId(request: APIRequestContext, sessionId: string): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        id = (await listQuestions(request)).find((q) => q.sessionId === sessionId)?.id ?? "";
        return id;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .not.toBe("");
  return id;
}

/** Open-question count read from the pill's accessible name (0 when the pill is absent). */
async function pillCount(page: Page): Promise<number> {
  const pill = page.getByTestId("question-pill");
  if ((await pill.count()) === 0) return 0;
  const label = (await pill.getAttribute("aria-label")) ?? "";
  return Number(/^(\d+)/.exec(label)?.[1] ?? 0); // "1 open question" / "N open questions"
}

/** Park a fresh visible session on a faux ask; returns its id and card. */
async function parkVisible(page: Page, scenario: string) {
  const card = await spawnFreshGitSession(page);
  const sessionId = (await card.getAttribute("data-session-id")) ?? "";
  expect(sessionId).toBeTruthy();
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  await expect(page.locator("[data-pending-ask]").first()).toBeVisible({ timeout: 30_000 });
  return { sessionId, card };
}

test.describe("pending-question stack (add-pending-question-stack)", () => {
  test("#F2 a hidden run's question is answered from the dialog; the run receives it and finishes", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await gotoDashboard(page);
    const hidden = await startHiddenPiSession(page.request);
    try {
      // `ask-select-roundtrip` is terminal: after the answer the run replies
      // "you picked <answer>" and its turn ends (unlike looping `ask-select`).
      const sent = await page.request.post(`/api/session/${hidden.id}/prompt`, {
        data: { text: "[[faux:ask-select-roundtrip]] go" },
      });
      expect(sent.ok(), `prompt → ${sent.status()}`).toBe(true);
      const questionId = await waitForQuestionId(page.request, hidden.id);

      const pill = page.getByTestId("question-pill");
      await expect(pill).toBeVisible({ timeout: 30_000 });
      const before = await pillCount(page);
      expect(before).toBeGreaterThanOrEqual(1);

      await pill.click();
      await expect(page.getByTestId("question-panel")).toBeVisible();
      const row = page.getByTestId(`question-row-${questionId}`);
      // Hidden session → "Answer here", never "Go to session".
      await expect(row).toContainText("Answer here");
      await row.click();

      const dialog = page.getByTestId("question-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      // Answer from the dialog, not the chat: the hidden session has no card.
      await dialog.getByRole("button", { name: /^b$/ }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // Pill count decrements (to 0 when this was the only open question).
      await expect.poll(() => pillCount(page), { timeout: 15_000 }).toBe(before - 1);
      await expect
        .poll(async () => (await listQuestions(page.request)).some((q) => q.id === questionId), {
          timeout: 15_000,
        })
        .toBe(false);

      // The run actually received the option and finished its turn: its
      // transcript (opened by id — it has no board card) carries the reply.
      await page.goto(`/session/${hidden.id}`);
      await expect(page.getByText(/you picked.*\bb\b/).first()).toBeVisible({ timeout: 60_000 });
    } finally {
      await stopHiddenPiSession(page.request, hidden.id);
    }
  });

  test("#F3 a visible session's entry navigates to the session with its inline prompt in view — no dialog", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { sessionId } = await parkVisible(page, "ask-select");
    const questionId = await waitForQuestionId(page.request, sessionId);

    // Select ANOTHER session, so the parked one is not on screen. A fresh
    // session has no pending ask, so any `[data-pending-ask]` afterwards can
    // only be the parked session's prompt.
    const other = await spawnFreshGitSession(page);
    await other.click();
    await expect(page.locator("[data-pending-ask]")).toHaveCount(0);

    const pill = page.getByTestId("question-pill");
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    const row = page.getByTestId(`question-row-${questionId}`);
    await expect(row).toContainText("Go to session");
    await row.click();

    const ask = page.locator("[data-pending-ask]").first();
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await expect(ask).toBeInViewport();
    await expect(ask.getByRole("button", { name: /alpha/i })).toBeVisible();
    await expect(page.getByTestId("question-dialog")).toHaveCount(0);
    await expect(page.getByTestId("question-panel")).toHaveCount(0);
  });

  test("#F7 mobile 375×812: pill ≥ 44×44, bottom sheet, full-viewport dialog, composer not covered", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const MOBILE = { width: 375, height: 812 } as const;

    // Spawn + park at DESKTOP (the spawn helper drives desktop affordances),
    // then enter the mobile tier. Two open questions: one visible, one hidden.
    const { sessionId } = await parkVisible(page, "ask-select");
    const hidden = await startHiddenPiSession(page.request);
    try {
      const sent = await page.request.post(`/api/session/${hidden.id}/prompt`, {
        data: { text: "[[faux:ask-select-roundtrip]] go" },
      });
      expect(sent.ok(), `prompt → ${sent.status()}`).toBe(true);
      const visibleQuestion = await waitForQuestionId(page.request, sessionId);
      const hiddenQuestion = await waitForQuestionId(page.request, hidden.id);

      await page.setViewportSize(MOBILE);
      await gotoDashboard(page);

      // Pill: ≥ 44×44 touch target, count ≥ 2.
      const pill = page.getByTestId("question-pill");
      await expect(pill).toBeVisible({ timeout: 30_000 });
      const pillBox = await pill.boundingBox();
      expect(pillBox, "pill must be laid out").not.toBeNull();
      expect(pillBox!.width, "pill width").toBeGreaterThanOrEqual(44);
      expect(pillBox!.height, "pill height").toBeGreaterThanOrEqual(44);
      expect(await pillCount(page)).toBeGreaterThanOrEqual(2);

      // Panel renders as a bottom sheet pinned to the viewport's bottom edge.
      await pill.click();
      const panel = page.getByTestId("question-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-variant", "sheet");
      const sheet = await panel.boundingBox();
      expect(sheet, "sheet must be laid out").not.toBeNull();
      expect(Math.abs(sheet!.x), "sheet spans from the left edge").toBeLessThanOrEqual(1);
      expect(Math.abs(sheet!.width - MOBILE.width), "sheet spans the viewport width").toBeLessThanOrEqual(1);
      expect(Math.abs(sheet!.y + sheet!.height - MOBILE.height), "sheet bottom is the viewport bottom").toBeLessThanOrEqual(1);
      // Row targets are ≥ 44 px tall on the mobile tier.
      const rowBox = await page.getByTestId(`question-row-${hiddenQuestion}`).boundingBox();
      expect(rowBox!.height, "row touch target").toBeGreaterThanOrEqual(44);

      // Hidden session's row → the dialog fills the viewport.
      await page.getByTestId(`question-row-${hiddenQuestion}`).click();
      const dialog = page.getByTestId("question-dialog");
      await expect(dialog).toBeVisible();
      const dlg = await dialog.boundingBox();
      expect(dlg, "dialog must be laid out").not.toBeNull();
      expect(Math.abs(dlg!.width - MOBILE.width), "dialog width = viewport").toBeLessThanOrEqual(1);
      expect(Math.abs(dlg!.height - MOBILE.height), "dialog height = viewport").toBeLessThanOrEqual(1);
      await page.getByTestId("question-later").click();
      await expect(dialog).toBeHidden();

      // Visible session's row → its chat; with panel + dialog closed the
      // composer must be the topmost element at its own centre (nothing —
      // scrim, sheet, dialog — left covering it).
      await pill.click();
      await page.getByTestId(`question-row-${visibleQuestion}`).click();
      await expect(page.getByTestId("question-panel")).toHaveCount(0);
      await expect(page.getByTestId("question-dialog")).toHaveCount(0);
      const composer = page.getByTestId("composer-root").first();
      await expect(composer).toBeVisible({ timeout: 30_000 });
      // Poll: the mobile list→chat slide transition must settle before the
      // composer's centre is inside the viewport (elementFromPoint is null off-screen).
      await expect
        .poll(
          () =>
            composer.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return hit !== null && el.contains(hit);
            }),
          { message: "composer is topmost at its centre", timeout: 10_000, intervals: [100, 250, 500] },
        )
        .toBe(true);
    } finally {
      await stopHiddenPiSession(page.request, hidden.id);
    }
  });

  test("#P1 removal propagation: answer in context A, row gone in context B — p95 ≤ 1000 ms over 20 samples", async ({
    page,
    browser,
  }) => {
    test.setTimeout(900_000);
    const SAMPLES = 20;
    const P95_BUDGET_MS = 1_000;

    // One session answered 20 times. `ask-select-roundtrip` is terminal, so
    // each sample re-prompts it over REST and gets a NEW question id.
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) ?? "";
    expect(sessionId).toBeTruthy();
    await card.click();
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 60_000 });

    const ctxB = await browser.newContext({ baseURL: BASE_URL });
    const samples: number[] = [];
    try {
      const pageB = await ctxB.newPage();
      await gotoDashboard(pageB);

      for (let i = 0; i < SAMPLES; i++) {
        const sent = await page.request.post(`/api/session/${sessionId}/prompt`, {
          data: { text: "[[faux:ask-select-roundtrip]] go" },
        });
        expect(sent.ok(), `sample ${i}: prompt → ${sent.status()}`).toBe(true);
        const questionId = await waitForQuestionId(page.request, sessionId);

        // B: open the panel on this question's row (the panel closes whenever
        // the stack empties, so it is re-opened per sample).
        const pillB = pageB.getByTestId("question-pill");
        await expect(pillB).toBeVisible({ timeout: 30_000 });
        if ((await pageB.getByTestId("question-panel").count()) === 0) await pillB.click();
        const rowTestId = `question-row-${questionId}`;
        await expect(pageB.getByTestId(rowTestId)).toBeVisible({ timeout: 15_000 });

        // B: arm an in-page observer that resolves with Date.now() the moment
        // the row leaves the DOM. Node and both pages share one host clock.
        const goneAt = pageB.evaluate(
          (testId) =>
            new Promise<number>((resolve) => {
              const gone = () => document.querySelector(`[data-testid="${testId}"]`) === null;
              if (gone()) return resolve(Date.now());
              const observer = new MutationObserver(() => {
                if (gone()) {
                  observer.disconnect();
                  resolve(Date.now());
                }
              });
              observer.observe(document.body, { subtree: true, childList: true });
            }),
          rowTestId,
        );
        await pageB.waitForTimeout(150); // observer armed before the click

        // A: answer the inline prompt. t0 is taken just before the click is
        // dispatched, so the sample also includes Playwright's click overhead
        // (conservative: it can only inflate the measurement).
        const pendingA = page.locator("[data-pending-ask]").first();
        await expect(pendingA.getByRole("button", { name: /^a$/ })).toBeVisible({ timeout: 30_000 });
        const t0 = Date.now();
        await pendingA.getByRole("button", { name: /^a$/ }).click();
        samples.push((await goneAt) - t0);

        // Let the run finish its turn before the next re-prompt.
        // (The transcript is virtualised, so count the card state, not DOM nodes.)
        await expect(card).toContainText(/Idle/, { timeout: 60_000 });
      }
    } finally {
      await ctxB.close();
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    console.log(`P1 removal propagation (ms) sorted=${JSON.stringify(sorted)} p95=${p95}`);
    expect(samples).toHaveLength(SAMPLES);
    expect(p95, `p95 removal propagation ${p95} ms`).toBeLessThanOrEqual(P95_BUDGET_MS);
  });
});
