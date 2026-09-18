import { connectBus, expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E — a reconnect snapshot re-arms a stale `pageExhausted` mark.
 *
 * The exhausted mark is client state: once the server replies
 * `sessions_page_result {hasMore:false}` the group's "more" affordance is
 * suppressed until `endedTotals` changes. A reconnect is the one case where
 * the totals can be BYTE-IDENTICAL and the mark must STILL clear: the snapshot
 * resets the paging offset to 0, so the pageable set is walkable again from
 * the start. A value-diff-only clear would leave the affordance dead for the
 * rest of the session — which is why `sessions_snapshot` clears the whole
 * exhausted set unconditionally, not via the `endedTotals` diff.
 *
 * Staging: `/fixtures/stub-dir` is the actual served group key. Pinning it
 * over the bus makes its ended row snapshot-visible, so `sessions_page` replies
 * empty and the group goes exhausted while the browser still shows `N ended`
 * with 0 held. Unpinning before the cut restores the pre-pin geometry, so the
 * reconnect snapshot carries the SAME `endedTotals` — asserted on the wire,
 * not assumed.
 *
 * The socket is cut through an `addInitScript` wrapper that tracks live
 * sockets, because `context.setOffline(true)` does NOT close an established
 * WebSocket. The wrapper deliberately does NOT block reconnects (unlike the
 * hard-offline variant in `session-state-honesty.spec.ts`): this scenario needs
 * the app's own `onclose` backoff to reconnect the SAME app instance, so the
 * exhausted mark survives in React state and only the snapshot can clear it.
 * A page reload would pass vacuously.
 *
 * Covers test-plan #X4 (task 6.3).
 * See change: close-registry-frame-shed-gaps.
 */

const STUB_DIR_CWD = "/fixtures/stub-dir";

/** Track live sockets so the established one can be closed on demand. */
async function armSocketCut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const w = window as unknown as { __dashSockets: WebSocket[]; WebSocket: typeof WebSocket };
    w.__dashSockets = [];
    const Wrapped = function (url: string, protocols?: string | string[]) {
      const socket = protocols === undefined ? new Real(url) : new Real(url, protocols);
      w.__dashSockets.push(socket);
      return socket;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = Real.prototype;
    Object.assign(Wrapped, Real);
    w.WebSocket = Wrapped;
  });
}

async function dropSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __dashSockets: WebSocket[] };
    for (const socket of w.__dashSockets) {
      try {
        socket.close();
      } catch {
        // already gone
      }
    }
  });
}

/** `endedTotals[<cwd>]` carried by each `sessions_snapshot` the page receives. */
function collectSnapshotTotals(page: Page, cwd: string): { seen: number[] } {
  const seen: number[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const raw = String(frame.payload);
      if (!raw.includes("sessions_snapshot")) return;
      try {
        const msg = JSON.parse(raw) as {
          type?: string;
          endedTotals?: Record<string, number>;
        };
        if (msg.type === "sessions_snapshot") seen.push(msg.endedTotals?.[cwd] ?? 0);
      } catch {
        /* non-JSON frame */
      }
    });
  });
  return { seen };
}

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
    const ack = client
      .waitFor((m) => m.type === "pinned_dirs_updated", { timeout: 20_000, label: `unpin(${path})` })
      .catch(() => undefined); // already unpinned → no broadcast
    client.send({ type: "unpin_directory", path });
    await ack;
  } finally {
    client.close();
  }
}

/**
 * Ended-count the expander reports. Read from `aria-label` ("Show/Hide N ended
 * sessions") — the VISIBLE label drops the count once expanded ("Hide ended").
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

test.describe("a reconnect snapshot re-arms a stale exhausted mark (X4)", () => {
  test.afterEach(async () => {
    await unpinOverBus(STUB_DIR_CWD).catch(() => {});
  });

  test("identical endedTotals across a reconnect still restore the 'more' control (test-plan #X4)", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await armSocketCut(page);
    const snapshots = collectSnapshotTotals(page, STUB_DIR_CWD);
    await gotoDashboard(page);

    const toggle = page.getByTestId(`folder-ended-toggle-${STUB_DIR_CWD}`);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    await ensureCollapsed(page, STUB_DIR_CWD);
    const total = await labelTotal(page, STUB_DIR_CWD);
    expect(total, "the seeded stub group must report ended sessions").toBeGreaterThan(0);

    // ---- mark the group exhausted ---------------------------------------
    await pinOverBus(STUB_DIR_CWD);
    await ensureExpanded(page, STUB_DIR_CWD);
    await expect(page.getByTestId(`folder-ended-more-${STUB_DIR_CWD}`)).toHaveCount(0, {
      timeout: 20_000,
    });
    expect(await labelTotal(page, STUB_DIR_CWD)).toBe(total);

    // Restore the pre-pin geometry so the reconnect snapshot is IDENTICAL —
    // same rows, same totals. The exhausted mark is untouched by an unpin
    // (no `endedTotals` mutation), which is exactly the stale state under test.
    await unpinOverBus(STUB_DIR_CWD);
    await expect(page.getByTestId(`folder-ended-more-${STUB_DIR_CWD}`)).toHaveCount(0);

    const snapshotsBefore = snapshots.seen.length;
    expect(snapshotsBefore).toBeGreaterThan(0);

    // ---- drop + reconnect ------------------------------------------------
    await dropSocket(page);
    // The app's own `onclose` backoff reconnects and the server replays a
    // fresh snapshot — the same app instance, so the exhausted mark is still
    // in React state when it lands.
    await expect.poll(() => snapshots.seen.length, { timeout: 60_000 }).toBeGreaterThan(
      snapshotsBefore,
    );

    // Byte-identical totals across the reconnect: the value diff cannot be
    // what clears the mark.
    expect(snapshots.seen[snapshots.seen.length - 1]).toBe(snapshots.seen[snapshotsBefore - 1]);
    await expect.poll(() => labelTotal(page, STUB_DIR_CWD), { timeout: 30_000 }).toBe(total);

    // ---- the affordance is available again -------------------------------
    await ensureExpanded(page, STUB_DIR_CWD);
    await expect(page.getByTestId(`folder-ended-more-${STUB_DIR_CWD}`)).toHaveCount(1, {
      timeout: 20_000,
    });
  });
});
