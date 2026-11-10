import { expect, type Page } from "@playwright/test";

/**
 * Socket-saturation helper for L3 specs: toggles the server's test-only
 * back-pressure injector `POST /api/test/force-shed { enabled }`. While on,
 * `sendTo` treats every browser socket as over `MAX_WS_BUFFER`, so transcript
 * frames shed exactly as on a saturated socket (and keyed frames defer).
 *
 * Chosen over CDP `Network.emulateNetworkConditions`: Chromium's network
 * throttling does not reliably apply to WebSocket frames, so it cannot cross
 * the server's buffer threshold deterministically.
 *
 * The route exists only under `PI_E2E_FORCE_SHED=1` (`docker/compose.test.yml`).
 * Enabling asserts the server reported `forceShed: true` — a harness booted
 * without the flag would otherwise turn a scenario into a silent no-op. The
 * injector is process-wide: always release it in `afterEach`.
 * See change: fix-background-subagent-ghost-rows (task 5.1).
 */
export async function setForceShed(page: Page, enabled: boolean): Promise<void> {
  const body = await page.evaluate(async (on) => {
    const res = await fetch("/api/test/force-shed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: on }),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as { data?: { forceShed?: boolean } } };
  }, enabled);
  expect(body.status, "force-shed route must exist (PI_E2E_FORCE_SHED=1)").toBe(200);
  expect(body.json?.data?.forceShed).toBe(enabled);
}

/** `/api/health#droppedFrames` counters a back-pressure spec reads. */
export async function droppedFrameCounters(page: Page): Promise<{ total: number; deferredSubagentFrames: number }> {
  return page.evaluate(async () => {
    const health = await (await fetch("/api/health")).json();
    return {
      total: health.droppedFrames.serverToBrowser.total as number,
      deferredSubagentFrames: health.droppedFrames.deferredSubagentFrames as number,
    };
  });
}
