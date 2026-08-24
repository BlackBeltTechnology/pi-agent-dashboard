import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, folderCard, folderHeaderBranch, gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

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
async function seedNeedsYou(page: Page): Promise<Locator> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, "[[faux:ask-select]] go");
  await expect(page.getByRole("button", { name: /alpha/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  return card;
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
    // Seed a needs-you session FIRST and give it a UNIQUE name: the filter
    // below must still match at least one session in this folder. A no-match
    // filter drops the whole folder from the sidebar (session-search
    // visibility rules), which removes the capsule with it and makes this
    // scenario unreachable — the target has to be filtered out while the
    // FOLDER stays rendered. A rename is required because every unnamed
    // session here falls back to the SAME display name (the cwd basename
    // `sample-git`), so no search term can separate two of them.
    const keepCard = await seedNeedsYou(page);
    const keepId = await keepCard.getAttribute("data-session-id");
    expect(keepId).toBeTruthy();
    const KEEP_NAME = "capsule-x1-keeper";
    const renamed = await page.request.post(`/api/session/${keepId}/rename`, {
      data: { name: KEEP_NAME },
    });
    expect(renamed.ok()).toBe(true);

    await seedError(page); // same page — see seedError's note
    await setCollapsed(page, false);
    await expect(segment(page, "error")).toBeVisible({ timeout: 15_000 });

    // The capsule counts from the folder's own session list, which ignores the
    // search box — so a segment can legitimately target a filtered-out card.
    // The folder filter is required alongside it: in session-search-only mode
    // the sidebar shows PINNED folders only, and this fixture folder is
    // unpinned.
    await page.getByTestId("workspace-filter-input").first().fill("sample-git");
    await page.getByTestId("session-search-input").first().fill(KEEP_NAME);

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
    await page.getByTestId("workspace-filter-input").first().fill("");
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

/**
 * Browser E2E — the folder header's git identity must never be borrowed from a
 * child session rooted in a DIFFERENT checkout.
 *
 * Covers test-plan #F1, #F2, #F3, #F4.
 * See change: fix-folder-header-worktree-branch-leak.
 *
 * Only a rendered UI against a real server can prove these: the leak is caused
 * by the server's `maybeRekeyOrder` moving a fresh worktree session to position
 * 0 of the PARENT folder's order, which no jsdom render can reproduce.
 */

/** Thin same-origin API caller (page context). Mirrors manage-worktrees.spec.ts. */
async function wtApi(page: Page, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, (i ?? undefined) as RequestInit | undefined);
      return { status: res.status, ...(await res.json().catch(() => ({}))) };
    },
    [path, init ? (JSON.parse(JSON.stringify(init)) as RequestInit) : null] as const,
  );
}

function postBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as RequestInit;
}

/** The fixture repo's own default branch — never assumed. */
async function fixtureBaseBranch(page: Page): Promise<string> {
  const res = await wtApi(page, `/api/git/worktrees?cwd=${encodeURIComponent(CWD)}`);
  const entries = ((res.data as { worktrees?: Array<Record<string, unknown>> })?.worktrees ?? []);
  const main = entries.find((e) => e.isMain === true);
  const branch = main?.branch as string | undefined;
  if (!branch) throw new Error(`could not resolve base branch: ${JSON.stringify(entries)}`);
  return branch;
}

/**
 * The `GroupGitInfo` container of a folder header — scoped to the CARD, since
 * it is a SIBLING of the `folder-home-row-<cwd>` name row, not a descendant.
 */
function folderGitRow(page: Page, cwd: string): Locator {
  return folderCard(page, cwd).getByTestId("git-branch-btn");
}

/** Branch text as the user reads it in the folder header, or "" when absent. */
const folderBranchText = folderHeaderBranch;

/** Worktrees + branches this block creates, so the shared container stays clean. */
const wtCreated = new Set<string>();
const wtBranches = new Set<string>();

test.describe("folder header git identity (worktree leak)", () => {
  // Teardown runs IN the container, matching manage-worktrees.spec.ts: the
  // fixture repo persists across spec runs, so a leftover `.worktrees/<name>`
  // makes the next create fail `path_exists`. Advisory — never fails a test.
  test.afterAll(() => {
    if (wtCreated.size === 0 && wtBranches.size === 0) return;
    // EVERYTHING inside the try, container discovery included: if the harness
    // has already stopped, `docker ps`/`docker exec` throws and would fail an
    // otherwise-completed spec. Teardown is advisory, never a verdict.
    try {
      const out = execFileSync(
        "docker",
        ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
        { encoding: "utf8" },
      ).trim();
      const container = out.split("\n").filter(Boolean)[0];
      if (container) {
        const git = (args: string[]) =>
          execFileSync("docker", ["exec", container, "git", "-C", CWD, ...args], { encoding: "utf8" });
        for (const p of wtCreated) { try { git(["worktree", "remove", "--force", p]); } catch { /* gone */ } }
        for (const b of wtBranches) { try { git(["branch", "-D", b]); } catch { /* gone */ } }
        try { git(["worktree", "prune"]); } catch { /* best-effort */ }
      }
    } catch {
      // teardown is advisory
    }
    wtCreated.clear();
    wtBranches.clear();
  });

  /**
   * Create a worktree in the fixture repo and spawn a session INSIDE it, then
   * wait for the bridge's `git_info_update` to fold it into the PARENT folder's
   * group (and re-key it to the FRONT of the order) — the exact leak trigger.
   * Returns the worktree branch name.
   */
  async function foldWorktreeChildIntoParent(page: Page, tag: string): Promise<string> {
    const base = await fixtureBaseBranch(page);
    const branch = `${tag}-${Date.now().toString(36)}`;
    const created = await wtApi(page, "/api/git/worktree", postBody({ cwd: CWD, base, newBranch: branch }));
    expect(created.success, JSON.stringify(created)).toBe(true);
    const wtPath = (created.data as { path: string }).path;
    wtCreated.add(wtPath);
    wtBranches.add(branch);
    const spawned = await wtApi(page, "/api/session/spawn", postBody({ cwd: wtPath }));
    expect(spawned.success, JSON.stringify(spawned)).toBe(true);
    // Poll until the server actually reports the fold, so a later assertion
    // cannot pass merely because the ineligible child never arrived.
    await expect
      .poll(async () => {
        const res = await wtApi(page, "/api/sessions");
        const rows = (res.data ?? []) as Array<{ cwd?: string; gitWorktree?: { mainPath?: string } }>;
        return rows.some((r) => r.cwd === wtPath && r.gitWorktree?.mainPath === CWD);
      }, { timeout: 60_000 })
      .toBe(true);
    return branch;
  }

  test("main folder header never shows a worktree branch (test-plan #F1)", async ({ page }) => {
    await gotoDashboard(page);
    // A main-checkout session so the folder group exists and is expanded.
    await ensureGitSession(page);
    await expandFolder(page, CWD);

    const base = await fixtureBaseBranch(page);
    await expect
      .poll(() => folderBranchText(page, CWD), { timeout: 30_000 })
      .toBe(base);

    // Sample the header CONTINUOUSLY across the whole sequence: the leak was a
    // transient wrong value, so a converged end-state assertion alone would
    // pass against the bug.
    const samples: string[] = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        samples.push(await folderBranchText(page, CWD).catch(() => ""));
        await page.waitForTimeout(150);
      }
    })();

    // Create the worktree + spawn a session inside it, and WAIT (polled) until
    // the server reports the fold. A fixed sleep here would make the whole test
    // vacuous on a loaded runner: if `git_info_update` were slower than the
    // window, the leak trigger never fires and the assertions below still pass.
    const branch = await foldWorktreeChildIntoParent(page, "wtleak");

    // Give the re-keyed group a moment to render, then stop sampling.
    await page.waitForTimeout(2_000);
    sampling = false;
    await sampler;

    expect(samples.length).toBeGreaterThan(10);
    expect(samples.filter((s) => s.includes(branch))).toEqual([]);
    await expect
      .poll(() => folderBranchText(page, CWD), { timeout: 30_000 })
      .toBe(base);
  });

  test("folder header renders no branch LINK and no PR pill from a child (test-plan #F2)", async ({ page }) => {
    // The whole git-identity tuple moves together: with the fallback restricted
    // to children rooted at the folder, an ineligible worktree child can supply
    // neither the branch URL nor the PR affordance.
    await gotoDashboard(page);
    await ensureGitSession(page);
    // An INELIGIBLE child must actually exist in the group, or the absence
    // assertions below would hold trivially and pass against the old code too.
    const wtBranch = await foldWorktreeChildIntoParent(page, "wtf2");
    await expandFolder(page, CWD);
    const btn = folderGitRow(page, CWD).first();
    await expect(btn).toBeVisible({ timeout: 30_000 });
    // The ineligible child's branch is never the header's branch.
    expect(await folderBranchText(page, CWD)).not.toContain(wtBranch);
    // No borrowed branch link: the branch label is plain text, not an anchor.
    const anchors = await btn.evaluate(
      (el) => el.parentElement?.querySelectorAll("a").length ?? 0,
    );
    expect(anchors).toBe(0);
    // No borrowed PR pill (`#<number>` link) either.
    const prPill = await btn.evaluate(
      (el) => /#\d+/.test(el.parentElement?.textContent ?? ""),
    );
    expect(prPill).toBe(false);
  });

  test("reload shows the parent branch from first paint (test-plan #F3)", async ({ page }) => {
    // The connect snapshot: `git_head_update` is broadcast only on
    // first-seen-or-change, so a reloaded tab used to receive NOTHING and fell
    // back to the (wrong) positional child branch indefinitely.
    await gotoDashboard(page);
    await ensureGitSession(page);
    const base = await fixtureBaseBranch(page);
    // Per test-plan #F3 the folder must hold a worktree session grouped under
    // its parent. Without it, a reloaded tab falling back to a positional child
    // would still show the right value and the test would prove nothing.
    await foldWorktreeChildIntoParent(page, "wtf3");
    await expandFolder(page, CWD);

    // `gotoDashboard` already does `page.goto("/")` — that IS the fresh
    // connection this test needs, so a preceding `page.reload()` is redundant.
    await gotoDashboard(page);
    await expandFolder(page, CWD);

    // Short timeout ON PURPOSE: the value must arrive from the connect
    // snapshot, not from the next 60s poll cycle or a genuine HEAD change.
    await expect
      .poll(() => folderBranchText(page, CWD), { timeout: 20_000 })
      .toBe(base);
  });

  test("header never renders an Init-git label for a git folder (test-plan #F4)", async ({ page }) => {
    // The resolved gate: a folder with no eligible child renders the existing
    // dimmed branch icon with NO new affordance. "Init git" stays gated on a
    // confirmed non-git signal, so it must never appear for the git fixture.
    await gotoDashboard(page);
    await ensureGitSession(page);
    await expandFolder(page, CWD);
    await expect(folderGitRow(page, CWD).first()).toBeVisible({ timeout: 30_000 });
    await expect(
      folderCard(page, CWD).getByText("Init git", { exact: true }),
    ).toHaveCount(0);
  });
});
