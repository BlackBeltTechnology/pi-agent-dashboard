import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

// change: compact-openspec-lifecycle-bar — rendered-UI behaviour of the
// 5-segment lifecycle bar that jsdom cannot assert: dnd press-vs-drag on the
// board (F9), the 250 px container-query label collapse (F10), ≥24 px segment
// hit targets (F11) and prefers-reduced-motion (F12). Drives the docker
// harness fixture `/fixtures/sample-git` change `e2e-artifact-demo` (all 4
// artifacts done, one task). The harness port comes from BASE_URL
// (`.pi-test-harness.json`) — never hardcoded.

const CHANGE = "e2e-artifact-demo";
const BOARD_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/openspec`;

/** Land on the OpenSpec board with the demo change's bar hydrated. */
async function openBoard(page: Page): Promise<Locator> {
  await ensureGitSession(page);
  await page.goto(BOARD_URL);
  await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 20_000 });
  const card = page.getByTestId(`board-card-${CHANGE}`);
  await card.getByTestId("openspec-stepper").waitFor({ state: "visible", timeout: 45_000 });
  return card;
}

interface Task { id: string; done: boolean; line: number }

async function readTasks(): Promise<Task[]> {
  const res = await fetch(`${BASE_URL}/api/openspec/tasks?cwd=${encodeURIComponent(FIXTURE_GIT)}&change=${CHANGE}`);
  const json = (await res.json()) as { data: { tasks: Task[] } };
  return json.data.tasks;
}

/** Flip every task to `done`. The toggle endpoint re-polls + broadcasts. */
async function setAllTasks(done: boolean): Promise<void> {
  for (const t of await readTasks()) {
    if (t.done === done) continue;
    const res = await fetch(`${BASE_URL}/api/openspec/tasks/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: FIXTURE_GIT, change: CHANGE, id: t.id, done, line: t.line }),
    });
    expect(res.ok, `toggle ${t.id} → ${done}`).toBe(true);
  }
}

test.describe("OpenSpec lifecycle bar", () => {
  test("F9: segment press on a board card opens the artifact, never drags the card", async ({ page }) => {
    const card = await openBoard(page);
    const columnOf = () =>
      card.evaluate((el) => el.closest("[data-testid^='board-column-body-']")?.getAttribute("data-testid") ?? null);
    const before = await columnOf();

    const seg = card.getByTestId("stepper-segment-design");
    const box = (await seg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByTestId("openspec-artifact-dialog")).toBeVisible();
    await expect(page.getByTestId("board-drag-chip")).toHaveCount(0);
    expect(await columnOf()).toBe(before);
  });

  test("F10: container query swaps labels to letters below 250 px; no overflow at any width", async ({ page }) => {
    const card = await openBoard(page);
    const bar = card.getByTestId("openspec-stepper");
    const proposal = bar.getByTestId("stepper-segment-proposal");
    const tasks = bar.getByTestId("stepper-segment-tasks");
    const { completedTasks, totalTasks } = await readTasks().then((ts) => ({
      completedTasks: ts.filter((t) => t.done).length,
      totalTasks: ts.length,
    }));

    for (const width of [280, 251, 250, 249, 220]) {
      await bar.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
      const full = width >= 250;
      await expect(proposal.locator(".openspec-seg-full")).toBeVisible({ visible: full });
      await expect(proposal.locator(".openspec-seg-short")).toBeVisible({ visible: !full });
      if (!full) await expect(proposal.locator(".openspec-seg-short")).toHaveText("P");
      await expect(tasks).toContainText(`${completedTasks}/${totalTasks}`);
      const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `bar overflows at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  // Measured on the board card: same `OpenSpecStepper` + `.openspec-seg` rule
  // as the session card, but free of the session card's attach precondition
  // (the fixture's OpenSpec skills readiness gates the attach combo).
  test("F11: every interactive segment is ≥24 px tall", async ({ page }) => {
    const card = await openBoard(page);
    const bar = card.getByTestId("openspec-stepper");
    const buttons = bar.locator("button[data-testid^='stepper-segment-']");
    const n = await buttons.count();
    expect(n, "at least one interactive segment").toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box?.height ?? 0, `segment ${i} height`).toBeGreaterThanOrEqual(24);
    }
  });

  test("F12: the current Archive track stops pulsing under prefers-reduced-motion", async ({ page }) => {
    await setAllTasks(true);
    try {
      const card = await openBoard(page);
      const archive = card.getByTestId("stepper-segment-archive");
      await expect(archive).toHaveAttribute("data-state", "current", { timeout: 45_000 });
      const animationName = () =>
        archive.locator(".openspec-seg-track").evaluate((el) => getComputedStyle(el).animationName);

      expect(await animationName()).not.toBe("none");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await animationName()).toBe("none");
    } finally {
      await setAllTasks(false);
    }
  });
});
