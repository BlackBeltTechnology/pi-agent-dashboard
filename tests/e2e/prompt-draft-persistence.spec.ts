import { type APIRequestContext, expect, type Page, test } from "./fixtures.js";
import { startHiddenPiSession, stopHiddenPiSession } from "./helpers/hidden-session.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Prompt-answer draft persistence (change: fix-input-state-consistency, #1117).
//
// A half-typed `ask_user` answer (Other text, a batch wizard's step + answers) used
// to vanish on a session switch or reload. Drafts now live in a per-tab in-memory
// store mirrored to `sessionStorage` (`ask-draft:<sessionId>:<promptId>`).
//
// S40 — Other text survives a switch to another session and back (same tab, no reload).
// S43 — a batch wizard restores its step + answers after a reload (sessionStorage mirror).
// S49 — the card and the pending-question dialog share one draft (same tab).
// S55 — a second tab starts with no draft; localStorage never holds one.
//
// Scenarios: qa/fixtures/faux-scenarios.ts → ask-select-other, ask-batch-steps.
// Assertions are web-first (`toHaveValue` / `toBeVisible`) — no fixed sleeps.

const OTHER_NAME = { name: "Other", exact: true } as const;

async function sessionIdFromUrl(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/session\/[^/?#]+/);
  const id = new URL(page.url()).pathname.split("/").pop();
  expect(id).toBeTruthy();
  return id as string;
}

/** Spawn a session, select it, run `scenario`, and return the pending ask card. */
async function parkAsk(page: Page, scenario: string) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
  const ask = page.locator("[data-pending-ask]").first();
  await expect(ask).toBeVisible({ timeout: 30_000 });
  return { card, ask };
}

async function typeOther(ask: ReturnType<Page["locator"]>, text: string) {
  await ask.getByRole("button", OTHER_NAME).click();
  await ask.getByRole("textbox", { name: "Other answer" }).fill(text);
}

test.describe("prompt draft persistence (#1117)", () => {
  test.setTimeout(240_000);

  test("S40: Other text survives a switch to another session and back", async ({ page }) => {
    // B first, A second: A is the newest card and is where the ask parks.
    const cardB = await spawnFreshGitSession(page);
    const { card: cardA, ask } = await parkAsk(page, "ask-select-other");
    await typeOther(ask, "foo");

    // Client-side switch (no reload): B, then back to A.
    await cardB.click();
    await expect(page.locator("[data-pending-ask]")).toHaveCount(0);
    await cardA.click();

    const restored = page.locator("[data-pending-ask]").first();
    await expect(restored).toBeVisible({ timeout: 15_000 });
    await expect(restored.getByRole("textbox", { name: "Other answer" })).toHaveValue("foo");
  });

  test("S43: a batch wizard restores its step and answers after a reload", async ({ page }) => {
    const { ask } = await parkAsk(page, "ask-batch-steps");
    // Step 1 (input) → Next → step 2 (select with Other) → Next → step 3.
    await ask.getByRole("textbox").fill("alpha");
    await ask.getByRole("button", { name: /Next/ }).click();
    await ask.getByRole("button", { name: "red", exact: true }).click();
    await ask.getByRole("button", { name: /Next/ }).click();
    await expect(ask.getByText("Question 3 of 3")).toBeVisible();

    // The mirror is debounced (300 ms) and flushed on pagehide: reload straight away.
    await page.reload();

    const restored = page.locator("[data-pending-ask]").first();
    await expect(restored).toBeVisible({ timeout: 60_000 });
    await expect(restored.getByText("Question 3 of 3")).toBeVisible();
    await restored.getByRole("button", { name: /Back/ }).click();
    await expect(restored.getByRole("button", { name: "red", exact: true })).toBeVisible();
    await restored.getByRole("button", { name: /Back/ }).click();
    await expect(restored.getByRole("textbox")).toHaveValue("alpha");
  });

  test("S55: a second tab shows no draft; localStorage holds none; the first tab restores after reload", async ({ page, context }) => {
    const { ask } = await parkAsk(page, "ask-select-other");
    await typeOther(ask, "tab-one");
    const sessionId = await sessionIdFromUrl(page);

    const tab2 = await context.newPage();
    try {
      await tab2.goto(`/session/${sessionId}`);
      const ask2 = tab2.locator("[data-pending-ask]").first();
      await expect(ask2).toBeVisible({ timeout: 60_000 });
      // A fresh tab: the Other row is collapsed, no text restored.
      await expect(ask2.getByRole("textbox", { name: "Other answer" })).toHaveCount(0);
    } finally {
      await tab2.close();
    }

    await page.reload();
    const restored = page.locator("[data-pending-ask]").first();
    await expect(restored).toBeVisible({ timeout: 60_000 });
    await expect(restored.getByRole("textbox", { name: "Other answer" })).toHaveValue("tab-one");

    const localKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ask-draft:")));
    expect(localKeys).toEqual([]);
  });
});

// S49 uses a hidden session: its question opens the pending-question DIALOG on top of
// the very session view that renders the inline card (`/session/:id` opens by id).

interface QuestionRowDto {
  id: string;
  sessionId: string;
}

async function waitForQuestionId(request: APIRequestContext, sessionId: string): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/questions");
        const body = (await res.json()) as { data?: QuestionRowDto[] };
        id = body.data?.find((q) => q.sessionId === sessionId)?.id ?? "";
        return id;
      },
      { timeout: 60_000 },
    )
    .not.toBe("");
  return id;
}

test.describe("prompt draft sharing (#1117)", () => {
  test.setTimeout(240_000);

  test("S49: the dialog shows the Other text typed on the chat card (same tab)", async ({ page }) => {
    await gotoDashboard(page);
    const hidden = await startHiddenPiSession(page.request);
    try {
      const sent = await page.request.post(`/api/session/${hidden.id}/prompt`, { data: { text: "[[faux:ask-select-other]] go" } });
      expect(sent.ok(), `prompt → ${sent.status()}`).toBe(true);
      const questionId = await waitForQuestionId(page.request, hidden.id);

      // Client-side navigation keeps the tab's in-memory store (same tab).
      await page.goto(`/session/${hidden.id}`);
      const ask = page.locator("[data-pending-ask]").first();
      await expect(ask).toBeVisible({ timeout: 60_000 });
      await typeOther(ask, "shared");

      await page.getByTestId("question-pill").click();
      await page.getByTestId(`question-row-${questionId}`).click();
      const dialog = page.getByTestId("question-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: "Other answer" })).toHaveValue("shared");
    } finally {
      await stopHiddenPiSession(page.request, hidden.id);
    }
  });
});
