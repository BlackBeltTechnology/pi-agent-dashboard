import { execFileSync } from "node:child_process";
import { connectBus, expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Browser E2E — ended-session paging never dead-ends on the same offset.
 *
 * `endedTotals` is the count of ended sessions the SERVER holds for a group;
 * the pageable set is `endedSequence(g)` minus the snapshot-visible ids. Those
 * two can disagree: a group whose ended rows all become snapshot-visible has a
 * non-zero total and an EMPTY pageable set. Before this change the client's
 * "more" affordance was driven by `labelCount > heldEnded` alone, so an empty
 * reply neither released the in-flight mark (it keyed on `pagedCount`
 * advancing) nor hid the control — the user was left with a button that
 * re-requested the SAME offset forever.
 *
 * Staging the disagreement needs an OUT-OF-BAND mutation, because no browser
 * action can shrink the pageable set without also changing the total:
 * pinning `/fixtures/stub-dir` over the bus moves its single ended session
 * into the per-group snapshot window (`snapshotVisibleIds` admits a group with
 * a pin), so `sessions_page` now replies `{sessions:[], hasMore:false}` while
 * the browser — which already holds its pre-pin snapshot — still shows
 * `1 ended` with 0 held.
 *
 * The dead-end is asserted ON THE WIRE (`framesent`), not by eyeballing the
 * DOM: the count of `sessions_page` frames the page SENDS for this group must
 * stay at 1 across a collapse/re-expand, proving the exhausted mark suppresses
 * the request rather than the UI merely hiding a button.
 *
 * Self-isolating: the injected discovery session is archived and its files
 * removed, and the pin is released, in `afterEach` — so a re-run starts from
 * the same seeded `1 ended`.
 *
 * Covers test-plan #F8 (task 6.2).
 * See change: close-registry-frame-shed-gaps.
 */

const STUB_DIR_CWD = "/fixtures/stub-dir";
/**
 * Bound on every synchronous `docker` call. Without one, a wedged Docker blocks
 * the worker out of its own `catch` and past the test timeout; with it, the
 * throw is an ordinary diagnostic the cleanup paths already swallow.
 */
const DOCKER_CALL_TIMEOUT_MS = 30_000;
/** The seeded out-of-window ended session in that group (`seed-sessions-window.mjs`). */
const STUB_SESSION_ID = "019f0000-0000-7000-8000-000000000001";
/** pi's encoded session directory for `STUB_DIR_CWD` (see `session-discovery.ts`). */
const STUB_SESSIONS_SUBDIR = "--fixtures-stub-dir--";
/**
 * Fixed `startedAt` for the injected record, which also stamps its on-disk file
 * name. Every injection — this run's and any earlier run's — shares it, so a
 * sweep can clear leftovers whose id is no longer known.
 */
const INJECTED_STAMP = "2020-01-01T00-00-00.000Z";

/**
 * Resolve the harness container by the dashboard port it publishes —
 * `test-up.sh` hash-derives a per-worktree compose project, so the container
 * name is not knowable here.
 */
function resolveContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8", timeout: DOCKER_CALL_TIMEOUT_MS },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function inContainer(container: string, script: string): string {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    // Bounded like `resolveContainer`: an unbounded sync child would block the
    // worker out of its own `catch` and past the test timeout if Docker wedged.
    timeout: DOCKER_CALL_TIMEOUT_MS,
  }).trim();
}

/** Every `sessions_page` frame the PAGE sends for one group key, in order. */
function collectPageRequests(page: Page, cwd: string): { count: () => number } {
  let sent = 0;
  page.on("websocket", (ws) => {
    ws.on("framesent", (frame) => {
      const raw = String(frame.payload);
      if (!raw.includes("sessions_page")) return;
      try {
        const msg = JSON.parse(raw) as { type?: string; cwd?: string };
        if (msg.type === "sessions_page" && msg.cwd === cwd) sent += 1;
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return { count: () => sent };
}

/** Pin (or re-pin) over the bus, awaiting the server's own confirmation. */
async function pinOverBus(path: string): Promise<void> {
  const client = await connectBus();
  try {
    const ack = client.waitFor((m) => m.type === "pinned_dirs_updated", {
      timeout: 20_000,
      label: `pin(${path})`,
    });
    client.send({ type: "pin_directory", path });
    await ack;
  } finally {
    client.close();
  }
}

async function unpinOverBus(path: string): Promise<void> {
  const client = await connectBus();
  try {
    client.send({ type: "unpin_directory", path });
    // Best-effort: a no-op unpin emits no broadcast to await.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    client.close();
  }
}

async function archiveOverBus(sessionId: string): Promise<void> {
  const client = await connectBus();
  try {
    client.send({ type: "archive_session", sessionId });
    await new Promise((r) => setTimeout(r, 1_000));
  } finally {
    client.close();
  }
}

/**
 * Ended-count the expander reports for a group. Read from `aria-label`
 * ("Show/Hide N ended sessions") — the VISIBLE label drops the count once
 * expanded ("Hide ended"), so the text node is only countable while collapsed.
 */
async function labelTotal(page: Page, cwd: string): Promise<number> {
  const label = (await page.getByTestId(`folder-ended-toggle-${cwd}`).getAttribute("aria-label")) ?? "";
  const m = label.match(/(\d+)/);
  return m ? Number(m[1]) : -1;
}

async function ensureExpanded(page: Page, cwd: string): Promise<void> {
  const toggle = page.getByTestId(`folder-ended-toggle-${cwd}`);
  if ((await toggle.getAttribute("aria-label"))?.startsWith("Show")) await toggle.click();
}

async function ensureCollapsed(page: Page, cwd: string): Promise<void> {
  const toggle = page.getByTestId(`folder-ended-toggle-${cwd}`);
  if ((await toggle.getAttribute("aria-label"))?.startsWith("Hide")) await toggle.click();
}

test.describe("ended paging never dead-ends on the same offset (F8)", () => {
  // Unique per run so a leftover from a previous run cannot make the
  // discovery a no-op (an already-held id emits no `session_added`).
  const injectedId = `019f0000-0000-7000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;

  /**
   * Delete every on-disk trace of an injected record — BOTH halves, this run's
   * and any earlier run's.
   *
   * Deliberately id-independent (`INJECTED_STAMP`), so it self-heals a leftover
   * whose own run could not reach the container: the `pi-state` volume persists
   * across runs within one harness lifetime, and a rediscovered stale record
   * would change the group's total and make F8 flaky.
   *
   * A container lookup / exec failure is LOGGED and swallowed. Teardown is
   * diagnostics, not assertion: a throw here would fail the test and mask the
   * real failure, which is the opposite of what a fixture should do.
   */
  function sweepInjections(): void {
    try {
      inContainer(
        resolveContainer(),
        `find "$HOME/.pi/agent" -name '${INJECTED_STAMP}_*' -delete 2>/dev/null; true`,
      );
    } catch (err) {
      console.warn(`[F8] on-disk injection cleanup skipped (harness gone?): ${String(err)}`);
    }
  }

  // Heal any leftover BEFORE the run stages its own injection.
  test.beforeEach(() => {
    sweepInjections();
  });

  test.afterEach(async () => {
    await archiveOverBus(injectedId).catch(() => {});
    await unpinOverBus(STUB_DIR_CWD).catch(() => {});
    sweepInjections();
  });

  test("an empty reply hides 'more' and suppresses the repeat request, and a totals change re-arms it (test-plan #F8)", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Must be installed before navigation: `page.on("websocket")` fires on
    // socket CREATION only.
    const pageRequests = collectPageRequests(page, STUB_DIR_CWD);
    await gotoDashboard(page);

    const toggle = page.getByTestId(`folder-ended-toggle-${STUB_DIR_CWD}`);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await ensureCollapsed(page, STUB_DIR_CWD);
    const initialTotal = await labelTotal(page, STUB_DIR_CWD);
    expect(initialTotal, "the seeded stub group must report ended sessions").toBeGreaterThan(0);

    // ---- stage the disagreement (out-of-band) ---------------------------
    // Pinning admits the group to the per-group snapshot window, so every
    // ended row is now snapshot-visible and `pageable` is empty. The browser
    // keeps its pre-pin snapshot: still `N ended`, still 0 held.
    await pinOverBus(STUB_DIR_CWD);

    // ---- expand: one request, an empty reply ----------------------------
    await ensureExpanded(page, STUB_DIR_CWD);
    await expect.poll(() => pageRequests.count(), { timeout: 15_000 }).toBe(1);

    // The reply carried nothing — the group's seeded ended row never
    // materialized (it is snapshot-visible server-side, hence unpageable).
    await expect(page.locator(`[data-session-id="${STUB_SESSION_ID}"]`)).toHaveCount(0, {
      timeout: 15_000,
    });
    // …and the affordance is GONE (exhausted), even though the label still
    // claims more ended sessions than the browser holds.
    await expect(page.getByTestId(`folder-ended-more-${STUB_DIR_CWD}`)).toHaveCount(0, {
      timeout: 15_000,
    });
    expect(await labelTotal(page, STUB_DIR_CWD)).toBe(initialTotal);

    // ---- no dead-end loop ----------------------------------------------
    // Re-expanding is exactly the gesture that used to re-issue offset 0.
    await ensureCollapsed(page, STUB_DIR_CWD);
    await ensureExpanded(page, STUB_DIR_CWD);
    await page.waitForTimeout(3_000);
    expect(pageRequests.count(), "no repeat request at the same offset").toBe(1);

    // ---- a totals change re-arms ----------------------------------------
    // Inject an ended session on disk, then re-pin: the pin path rediscovers
    // the directory, registers the new record and broadcasts `session_added`
    // for an already-ended session — an `endedTotals` mutation, which clears
    // the exhausted mark.
    const container = resolveContainer();
    const dir = `"$HOME/.pi/agent/sessions/${STUB_SESSIONS_SUBDIR}"`;
    const stamp = INJECTED_STAMP;
    inContainer(
      container,
      [
        `mkdir -p ${dir}`,
        `printf '%s\\n' '{"type":"session","id":"${injectedId}","cwd":"${STUB_DIR_CWD}"}' > ${dir}/${stamp}_${injectedId}.jsonl`,
        `printf '%s\\n' '{"cwd":"${STUB_DIR_CWD}","status":"ended","startedAt":1577836800000,"endedAt":1577836801000,"name":"F8 injected"}' > ${dir}/${stamp}_${injectedId}.meta.json`,
      ].join(" && "),
    );
    await pinOverBus(STUB_DIR_CWD);

    await expect
      .poll(() => labelTotal(page, STUB_DIR_CWD), { timeout: 30_000 })
      .toBe(initialTotal + 1);
    await expect(page.getByTestId(`folder-ended-more-${STUB_DIR_CWD}`)).toHaveCount(1, {
      timeout: 15_000,
    });
  });
});
