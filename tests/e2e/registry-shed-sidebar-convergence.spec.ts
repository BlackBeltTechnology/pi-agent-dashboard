import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, spawnFreshGitSession } from "./helpers/index.js";

/**
 * Browser E2E — a shed REGISTRY burst still yields a complete sidebar.
 *
 * `session_added` / `session_removed` / `session_updated` are all
 * transcript-class (`frameClassOf` default arm), so above `MAX_WS_BUFFER` they
 * are shed with no seq, no backfill and no guaranteed successor. Before this
 * change only `session_updated` was owed back, so a shed lifecycle frame left
 * the sidebar permanently wrong until a reconnect: a session the server holds
 * had NO row at all, and an ended one kept rendering as live.
 *
 * This spec drives a REAL socket over the shed threshold with the test-only
 * injector `POST /api/test/force-shed` (registered only under
 * `PI_E2E_FORCE_SHED=1`, which `docker/compose.test.yml` sets), ends one
 * session and spawns another while every registry frame is being dropped, then
 * drains and asserts the sidebar converges from the server's CURRENT state:
 * the ended session lands in its ended bucket, the session spawned during the
 * blackout gets a row (a reconciled `session_added`), and no reload or
 * reconnect was needed.
 *
 * The injector is process-wide; `afterEach` always releases it, including on
 * failure. `playwright.config.ts` pins `workers: 1` + `fullyParallel: false`,
 * so no sibling spec runs while it is on.
 *
 * Covers test-plan #F7 (task 6.1).
 * See change: close-registry-frame-shed-gaps.
 */

interface ServerSession {
  id: string;
  cwd: string;
  status?: string;
  live?: boolean;
  hidden?: boolean;
}

/** The server's own record view — truth the browser socket cannot distort. */
async function serverSessions(page: Page): Promise<ServerSession[]> {
  return page.evaluate(async () => {
    const body = await (await fetch("/api/sessions")).json();
    return (body.data ?? []) as ServerSession[];
  });
}

interface ReconcileCounters {
  queued: number;
  sent: number;
}

async function reconcileCounters(page: Page): Promise<ReconcileCounters> {
  return page.evaluate(async () => {
    const health = await (await fetch("/api/health")).json();
    return {
      queued: health.droppedFrames.statusReconcileQueued as number,
      sent: health.droppedFrames.statusReconcileSent as number,
    };
  });
}

/**
 * Toggle the injector. The ENABLE assertion proves `PI_E2E_FORCE_SHED=1`
 * actually reached the server — without it, a harness booted without the flag
 * would turn this whole scenario into a no-op that passes.
 */
async function setForceShed(page: Page, enabled: boolean): Promise<void> {
  const body = await page.evaluate(async (on) => {
    const res = await fetch("/api/test/force-shed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: on }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }, enabled);
  expect(body.status, "force-shed route must exist (PI_E2E_FORCE_SHED=1)").toBe(200);
  expect(body.json?.data?.forceShed).toBe(enabled);
}

/** Rendered sidebar row ids — the rendered truth the assertions compare against. */
async function renderedIds(page: Page): Promise<string[]> {
  return (
    (await page
      .locator("[data-session-id]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id")))) as (string | null)[]
  ).filter((id): id is string => Boolean(id));
}

test.describe.configure({ mode: "serial" });

test.describe("shed registry frames reconcile into a complete sidebar", () => {
  test.afterEach(async ({ page }) => {
    // Process-wide injector: a leaked `true` would starve every later spec.
    await setForceShed(page, false).catch(() => {});
  });

  test("a registry burst shed during a blackout converges after drain (test-plan #F7)", async ({
    page,
  }) => {
    // Two real pi spawns plus a shutdown — 60 s is not enough.
    test.setTimeout(300_000);

    await gotoDashboard(page);
    const cardA = await spawnFreshGitSession(page);
    const idA = (await cardA.getAttribute("data-session-id"))!;
    const recordA = (await serverSessions(page)).find((s) => s.id === idA);
    expect(recordA, "spawned session must be server-held").toBeTruthy();
    const cwd = recordA!.cwd;

    const before = await reconcileCounters(page);

    // ---- blackout ------------------------------------------------------
    await setForceShed(page, true);

    // (1) End A. Its `session_updated {ended}` AND its `session_removed` are
    //     both shed — the debt is `{kind:"removed", sawAdd:false}` (A's own
    //     add was delivered before the blackout).
    const shutdown = await page.evaluate(
      async (id) => (await fetch(`/api/session/${id}/shutdown`, { method: "POST" })).status,
      idA,
    );
    expect(shutdown).toBe(200);

    // The shed is REAL, not assumed: the server recorded the debt. Without
    // this, the "no row" assertions below would also pass if the server had
    // simply never emitted the frames.
    await expect
      .poll(async () => (await reconcileCounters(page)).queued, { timeout: 60_000 })
      .toBeGreaterThan(before.queued);

    // (2) Spawn B while still shed. Driven over REST so the spawn does not
    //     depend on the (blacked-out) browser socket at all.
    // Snapshot the server's ids FIRST, so B is identified as the id that
    // APPEARED — not merely "some live session in this cwd except A". A
    // pre-existing live session in the same cwd would otherwise be misread as
    // B and fail the row assertion below while reconciliation actually worked.
    const idsBeforeSpawn = new Set((await serverSessions(page)).map((s) => s.id));
    const spawn = await page.evaluate(
      async (dir) =>
        (
          await fetch("/api/session/spawn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd: dir }),
          })
        ).status,
      cwd,
    );
    expect(spawn).toBe(200);

    // Server-side registration, read from the server's own record view.
    let idB = "";
    await expect
      .poll(
        async () => {
          const fresh = (await serverSessions(page)).find(
            (s) => s.cwd === cwd && !idsBeforeSpawn.has(s.id) && s.status !== "ended" && !s.hidden,
          );
          if (fresh) idB = fresh.id;
          return Boolean(fresh);
        },
        { timeout: 120_000 },
      )
      .toBe(true);

    // Blackout is visible in the UI: B has no row at all, and A is still
    // rendered (as a live card) despite having ended.
    const idsDuringShed = await renderedIds(page);
    expect(idsDuringShed, "B's session_added was shed").not.toContain(idB);
    expect(idsDuringShed, "A's removal was shed — its row is still live").toContain(idA);

    // ---- drain ---------------------------------------------------------
    const urlBefore = page.url();
    await setForceShed(page, false);

    // B converges: the owed `added` flushes as a reconciled `session_added`
    // carrying the CURRENT record.
    await expect(page.locator(`[data-session-id="${idB}"]`)).toHaveCount(1, { timeout: 15_000 });

    // A converges the other way: the owed `removed` over an ended record with
    // `sawAdd:false` flushes as `session_removed`, so the row leaves the live
    // list for the (collapsed) ended bucket.
    await expect(page.locator(`[data-session-id="${idA}"]`)).toHaveCount(0, { timeout: 15_000 });

    // No reload, no navigation — only the socket recovering.
    expect(page.url()).toBe(urlBefore);
    expect((await reconcileCounters(page)).sent).toBeGreaterThan(before.sent);

    // Statuses match server truth: every live session the server holds for
    // THIS cwd has a rendered row (scoped — a global count would break on a
    // sibling spec's leftovers).
    const held = (await serverSessions(page)).filter(
      (s) => s.cwd === cwd && s.status !== "ended" && !s.hidden,
    );
    expect(held.map((s) => s.id)).toContain(idB);
    const rendered = new Set(await renderedIds(page));
    for (const s of held) {
      expect(rendered, `server-held live session ${s.id} must have a sidebar row`).toContain(s.id);
    }

    // …and the ended one is not LOST, it is in its ended bucket.
    const endedToggle = page.getByTestId(`folder-ended-toggle-${cwd}`);
    await expect(endedToggle).toBeVisible({ timeout: 15_000 });
    if ((await endedToggle.getAttribute("aria-label"))?.startsWith("Show")) {
      await endedToggle.click();
    }
    await expect(page.locator(`[data-session-id="${idA}"]`)).toHaveCount(1, { timeout: 20_000 });
  });
});
