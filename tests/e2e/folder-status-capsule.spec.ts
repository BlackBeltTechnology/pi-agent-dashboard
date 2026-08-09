import { expect, type Locator, type Page, test } from "@playwright/test";
import { FIXTURE_GIT, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — the folder header status capsule.
 *
 * These scenarios need REAL geometry and REAL session state: wrap behaviour at
 * a narrow sidebar, expansion-ordered scrolling (the card only mounts under
 * `{!isCollapsed && …}`), and the reveal path's degrade notices are all things
 * jsdom cannot express. The counting pass and the capsule's own render are
 * unit-tested in `packages/client/src/lib/__tests__/session-status-visuals.test.ts`
 * and `packages/client/src/components/__tests__/FolderStatusCapsule.test.tsx`.
 *
 * Covers test-plan #F1, #F2, #F3, #F4, #F7, #F9, #X1, #X2.
 * See change: unify-folder-status-capsule.
 *
 * Counts are NOT asserted absolutely: specs share one container, so sibling
 * specs leave sessions in this same fixture folder. Every assertion is about
 * presence, ORDER, or behaviour — never an absolute total.
 */

const CWD = FIXTURE_GIT;

function capsule(page: Page): Locator {
  return page.getByTestId(`folder-status-capsule-${CWD}`).first();
}

function segment(page: Page, key: "needs-you" | "error" | "working" | "idle"): Locator {
  return page.getByTestId(`folder-capsule-seg-${key}-${CWD}`).first();
}

/** The folder card owning this cwd (scopes the non-cwd-keyed collapse chevron). */
function folderCard(page: Page, cwd: string): Locator {
  return page
    .locator('[data-testid="sortable-workspace-folder"], [data-testid="sortable-pinned-group"]')
    .filter({ has: page.getByTestId(`folder-home-row-${cwd}`) })
    .first();
}

async function isCollapsed(page: Page): Promise<boolean> {
  // Read the collapse state from the folder BODY, which `SessionList` renders
  // only when expanded. Inferring it from card presence is wrong twice over: a
  // folder with no live sessions renders expanded with no cards, and one whose
  // sessions have all ended keeps its cards behind the "Show N ended"
  // disclosure — both would misreport as collapsed and hang the poll below.
  return (await page.getByTestId(`folder-body-${CWD}`).count()) === 0;
}

async function setCollapsed(page: Page, want: boolean): Promise<void> {
  if ((await isCollapsed(page)) === want) return;
  await folderCard(page, CWD).getByTestId("folder-toggle-btn").first().click();
  await expect
    .poll(() => isCollapsed(page), { timeout: 15_000 })
    .toBe(want);
}

/** Segment keys currently rendered, in DOM order. */
async function renderedSegments(page: Page): Promise<string[]> {
  return capsule(page)
    .locator("[data-capsule-segment]")
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.capsuleSegment ?? ""),
    );
}

/** Text of each rendered segment, keyed — the count as the user reads it. */
async function segmentCounts(page: Page): Promise<Record<string, string>> {
  return capsule(page)
    .locator("[data-capsule-segment]")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((n) => [
          (n as HTMLElement).dataset.capsuleSegment ?? "",
          (n.textContent ?? "").trim(),
        ]),
      ),
    );
}

/** Park a fresh session on an unanswered `ask_user` prompt (needs-you). */
async function seedNeedsYou(page: Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, "[[faux:ask-select]] go");
  await expect(page.getByRole("button", { name: /alpha/i }).first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Drive a fresh session into a settled terminal error (error segment).
 *
 * MUST be called in the SAME page that asserts the error segment: the capsule's
 * error bucket is fed by `errorSessionIds`, which App.tsx derives from the
 * client-side `sessionStates[].lastError` reducer field. That is live-event
 * state, not server state — a fresh page load rebuilds from replay and the
 * error segment is legitimately absent. Seeding once in an earlier test and
 * expecting it to persist across pages is the trap here.
 */
async function seedError(page: Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, "[[faux:model-error]] go");
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("folder status capsule", () => {
  test("capsule renders and survives expansion with identical counts (test-plan #F1)", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await seedNeedsYou(page);
    await seedError(page);

    await setCollapsed(page, true);
    await expect(capsule(page)).toBeVisible({ timeout: 15_000 });
    const collapsedSegments = await renderedSegments(page);
    const collapsedCounts = await segmentCounts(page);
    // Mixed live states are present while collapsed — this is the regression
    // the change fixes (the old rollup was collapsed-only, the pill separate).
    expect(collapsedSegments).toContain("needs-you");
    expect(collapsedSegments).toContain("error");

    await setCollapsed(page, false);
    await expect(capsule(page)).toBeVisible();
    // Identical across the transition — same segments, same counts.
    expect(await renderedSegments(page)).toEqual(collapsedSegments);
    expect(await segmentCounts(page)).toEqual(collapsedCounts);
  });

  test("segments render in fixed severity order (test-plan #F1)", async ({ page }) => {
    await gotoDashboard(page);
    // Without these two guards an absent capsule yields [], and [] trivially
    // equals the filtered severity list — the assertion could never fail.
    await expect(capsule(page)).toBeVisible({ timeout: 15_000 });
    const rendered = await renderedSegments(page);
    expect(rendered.length).toBeGreaterThan(0);

    const severity = ["needs-you", "error", "working", "idle"];
    // Whatever subset is present must appear in severity order.
    expect(rendered).toEqual(severity.filter((k) => rendered.includes(k)));
  });

  test("activating the error segment expands the folder and reveals the errored session (test-plan #F2, #F4)", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await seedError(page); // same page — see seedError's note
    await setCollapsed(page, true);
    await expect(segment(page, "error")).toBeVisible({ timeout: 15_000 });

    await segment(page, "error").click();

    // Folder converged to expanded...
    await expect.poll(() => isCollapsed(page), { timeout: 15_000 }).toBe(false);
    // ...and the errored session was selected — its settled error card is the
    // proof the reveal landed on a session in the state the segment counted.
    await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30_000 });

    // #F4: the scroll is sequenced AFTER the expansion commits, so the target
    // card is actually laid out (height > 0) rather than a silent no-op against
    // a body that had not mounted. Locate the FLASHED card specifically — the
    // reveal path adds `card-seek-flash` only once it has scrolled a laid-out
    // element. Falling back to any `[data-session-id]` would pass even if the
    // reveal never ran.
    const flashed = page.locator("[data-session-id].card-seek-flash").first();
    await expect(flashed).toBeVisible({ timeout: 15_000 });
    const box = await flashed.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });

  test("segment activation does not trigger the header row handler (test-plan #F3)", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await seedError(page); // same page — see seedError's note
    await setCollapsed(page, false);
    const before = page.url();

    await expect(segment(page, "error")).toBeVisible({ timeout: 15_000 });
    await segment(page, "error").click();

    // Wait for a state that PROVES the click was processed — otherwise a polled
    // negative matcher passes on the first tick, before any navigation could
    // have happened, and the assertion is vacuous.
    await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30_000 });

    // The row's own click handler navigates to the directory home. Propagation
    // is stopped, so the URL must NOT have become /folder/<encoded cwd>.
    expect(before).not.toMatch(/\/folder\//);
    expect(page.url()).not.toMatch(/\/folder\//);
    // And the folder stays expanded — activation never toggles the row.
    expect(await isCollapsed(page)).toBe(false);
  });

  test("capsule never wraps at a narrow sidebar; the name absorbs the squeeze (test-plan #F7)", async ({
    page,
  }) => {
    // Workload relaxed from "all four segments at 3-glyph counts" (400+ real
    // sessions, not seedable against this harness) to the segments this folder
    // actually carries. The invariant — one row, no shed segments, name
    // truncates — is unchanged. See the note in test-plan.md.
    await gotoDashboard(page);
    await expect(capsule(page)).toBeVisible({ timeout: 15_000 });
    const wideSegments = await renderedSegments(page);
    expect(wideSegments.length).toBeGreaterThan(0);
    const leaf = page.getByTestId(`folder-header-leaf-${CWD}`).first();
    const nameWidthBefore = (await leaf.boundingBox())?.width ?? 0;

    await page.setViewportSize({ width: 900, height: 800 });
    const sidebar = folderCard(page, CWD);
    await sidebar.evaluate((el) => {
      // Narrow the folder card itself to the 220px budget the spec names.
      (el as HTMLElement).style.width = "220px";
      (el as HTMLElement).style.maxWidth = "220px";
    });

    await expect(capsule(page)).toBeVisible();
    // Sheds nothing.
    expect(await renderedSegments(page)).toEqual(wideSegments);

    // Stays on ONE row: the capsule's height must not exceed a single segment's.
    const capsuleBox = await capsule(page).boundingBox();
    const segBox = await capsule(page).locator("[data-capsule-segment]").first().boundingBox();
    expect(capsuleBox).toBeTruthy();
    expect(segBox).toBeTruthy();
    expect(capsuleBox!.height).toBeLessThan((segBox!.height ?? 0) * 1.6);

    // The name region absorbed the reduction. Asserted as a strict shrink of
    // the name against its own pre-narrowing width — an `A || B` over a clipped
    // flag and an absolute width was satisfiable without the capsule behaving.
    const nameWidthAfter = (await leaf.boundingBox())?.width ?? 0;
    expect(nameWidthBefore).toBeGreaterThan(0);
    expect(nameWidthAfter).toBeLessThan(nameWidthBefore);

    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("needs-you count never spikes above its settled value on load (test-plan #F9)", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await seedNeedsYou(page); // same page: the probe timing is what is under test
    await expect(capsule(page)).toBeVisible({ timeout: 15_000 });
    const settledText = (await segmentCounts(page))["needs-you"] ?? "0";
    const settled = Number.parseInt(settledText.replace(/\D/g, "") || "0", 10);

    // Reload and sample the needs-you segment across the mount window. The
    // widget-bar probes resolve on a later tick; an unclassified candidate must
    // be EXCLUDED until it reports, so the count converges upward only and can
    // never read higher than its settled value.
    await page.reload();
    const samples: number[] = [];
    for (let i = 0; i < 25; i++) {
      const txt = await page
        .getByTestId(`folder-capsule-seg-needs-you-${CWD}`)
        .first()
        .textContent()
        .catch(() => null);
      if (txt !== null) samples.push(Number.parseInt(txt.replace(/\D/g, "") || "0", 10));
      await page.waitForTimeout(80);
    }
    await expect(capsule(page)).toBeVisible({ timeout: 15_000 });
    // An empty sample set would skip the loop entirely and pass vacuously.
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s).toBeLessThanOrEqual(settled);
  });

  test("activating a segment whose target the search filter hides degrades with a notice (test-plan #X1)", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await seedError(page); // same page — see seedError's note
    await setCollapsed(page, false);
    await expect(segment(page, "error")).toBeVisible({ timeout: 15_000 });

    // The capsule counts from the folder's own session list, which ignores the
    // search box — so a segment can legitimately target a filtered-out card.
    await page.getByTestId("session-search-input").first().fill("zzz-no-such-session-zzz");

    // Capsule counts are filter-blind: the segment is still there.
    await expect(segment(page, "error")).toBeVisible();
    await segment(page, "error").click();

    // Degrades through the reveal path's FILTERED notice specifically. Also
    // accepting the generic 5 s give-up toast would let an unrelated reveal
    // failure satisfy #X1; `classifyDegrade` returns "filtered" here, so the
    // filtered copy is the only correct outcome.
    await expect(page.getByText(/filter is hiding/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId("session-search-input").first().fill("");
  });

  test("hiding the only errored session drops its segment, never a dead target (test-plan #X2)", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await setCollapsed(page, false);

    // Seed an errored session in THIS page (errorSessionIds is client-side
    // reducer state — see seedError) and confirm the segment appears, so the
    // disappearance below is attributable to hiding rather than to it never
    // having rendered.
    await seedError(page);
    const errorSeg = segment(page, "error");
    await expect(errorSeg).toBeVisible({ timeout: 15_000 });

    // Hide the errored session. `showHidden` is off by default, so the card
    // leaves the list.
    const card = page.locator("[data-session-id]").filter({ has: page.getByTestId("error-banner") });
    const target = (await card.count()) > 0 ? card.first() : page.locator("[data-session-id]").first();
    await target.getByRole("button", { name: /hide session/i }).first().click();

    // #E7: hidden sessions are excluded BEFORE bucketing, so the capsule must
    // stop counting that state entirely rather than keep a segment whose only
    // target is unreachable.
    await expect(errorSeg).toHaveCount(0, { timeout: 15_000 });
  });
});
