import { expect, type WebSocket as PWWebSocket, test } from "@playwright/test";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";

// change: fix-reducer-crash-undefined-toolname (manual tasks 5.1 + 5.2).
//
// The real crash: a `tool_execution_start` event with an absent `toolName`
// persisted into the durable IndexedDB replay cache (`pi-dashboard-replay-cache`,
// store `sessions`). On reload, `rehydrateSession` re-reduces that cached tail
// at App-level `useState` — ABOVE every React error boundary — so the old
// `data.toolName.toLowerCase()` threw and black-screened the whole app (root
// unmount), not the "Chat view encountered an error" card.
//
// Unit coverage (rehydrate-session.poisoned-cache.test.ts + reducer tolerance
// tests) proves the logic; this spec is the real-browser integration proof the
// units cannot give: it poisons the actual IndexedDB the running client reads,
// reloads a live Dockerized session, and asserts the shell survives.
//
// Needs PI_E2E_SEED=1 (managed harness sets it) for the faux model.

const CACHE_DB = "pi-dashboard-replay-cache";
const CACHE_STORE = "sessions";

test.describe("reducer crash — poisoned replay cache self-heals", () => {
  test.setTimeout(90_000);

  // Task 5.1 — with a poisoned cache entry present, a cold reload re-reduces
  // the tail without black-screening and without the `toLowerCase` TypeError.
  test("undefined-toolName cached event reloads without crashing", async ({ page }) => {
    // Capture uncaught exceptions from the very start (the crash surfaces as a
    // pageerror, since it escapes above the ChatView error boundary).
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    // Drive a faux round-trip so the session accrues events and the debounced
    // writer persists a real cache entry to IndexedDB.
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });

    // Let the debounced replay-cache writer (~1s) flush the entry.
    await page.waitForTimeout(1_800);

    // Poison the persisted entry: append a `tool_execution_start` whose
    // `toolName` is ABSENT (reads as undefined) — the exact malformed shape
    // pi core emits for some tools and the bridge forwards verbatim. Preserve
    // schemaVersion so the entry stays a HIT (a version mismatch would just
    // drop it → clean full replay, not exercising the reducer path).
    const poisoned = await page.evaluate(
      async ({ sid, dbName, storeName }) => {
        const reqP = <T>(req: IDBRequest<T>) =>
          new Promise<T>((res, rej) => {
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open(dbName, 1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        try {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const entry = (await reqP(store.get(sid))) as
            | { maxSeq: number; payload: Array<{ seq: number; event: unknown }> }
            | undefined;
          if (!entry) return false;
          const nextSeq = (entry.maxSeq ?? 0) + 1;
          entry.payload.push({
            seq: nextSeq,
            // NOTE: `toolName` deliberately omitted → undefined at runtime.
            event: {
              sessionId: sid,
              eventType: "tool_execution_start",
              timestamp: Date.now(),
              data: { toolCallId: "poison-tool" },
            },
          });
          entry.maxSeq = nextSeq;
          store.put(entry);
          await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
            tx.onabort = () => rej(tx.error);
          });
          return true;
        } finally {
          db.close();
        }
      },
      { sid: sessionId as string, dbName: CACHE_DB, storeName: CACHE_STORE },
    );
    expect(poisoned, "expected a persisted replay-cache entry to poison").toBe(true);

    await page.reload();

    // The shell must still mount — a black screen (root unmount) never renders
    // the app bar. This is the load-bearing "no crash" assertion.
    await byTestId(page, "headerAppBar").waitFor({ state: "visible", timeout: 30_000 });
    // Rehydrate re-reduced the poisoned tail (coalescing the missing name to
    // "unknown") and painted the prior transcript.
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });

    const toLowerCaseCrash = pageErrors.filter((e) => /toLowerCase/i.test(e));
    expect(
      toLowerCaseCrash,
      `uncaught toLowerCase crash after reload:\n${toLowerCaseCrash.join("\n")}`,
    ).toHaveLength(0);
  });

  // Task 5.2 — clearing the cache and reloading still loads the session via a
  // full replay (lastSeq: 0), identical result: no regression to the clean path.
  test("cleared cache reloads via full replay", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId).toBeTruthy();

    await card.click();
    await sendPrompt(page, "[[faux:plain-text]] go");
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_800);

    // Clear the whole cache store (non-blocking, unlike deleteDatabase which the
    // app's still-open connection would block).
    await page.evaluate(
      async ({ dbName, storeName }) => {
        const db = await new Promise<IDBDatabase>((res, rej) => {
          const r = indexedDB.open(dbName, 1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        try {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).clear();
          await new Promise<void>((res, rej) => {
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
            tx.onabort = () => rej(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { dbName: CACHE_DB, storeName: CACHE_STORE },
    );

    // Capture the post-reload subscribe: with no cached cursor it must be a
    // full replay (lastSeq: 0 / absent) — the mirror of the delta-replay proof.
    const subscribes: Array<{ sessionId?: string; lastSeq?: number }> = [];
    page.on("websocket", (ws: PWWebSocket) => {
      ws.on("framesent", (frame) => {
        const payload =
          typeof frame.payload === "string" ? frame.payload : frame.payload.toString("utf8");
        try {
          const msg = JSON.parse(payload) as { type?: string; sessionId?: string; lastSeq?: number };
          if (msg.type === "subscribe") subscribes.push(msg);
        } catch {
          /* non-JSON frame */
        }
      });
    });

    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible", timeout: 30_000 });

    // A full-replay subscribe (lastSeq 0) was sent for this session.
    await expect
      .poll(
        () => {
          const forSession = subscribes.filter((s) => s.sessionId === sessionId);
          return forSession.length > 0 && forSession.every((s) => (s.lastSeq ?? 0) === 0);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // Identical result: the transcript still paints via full replay.
    await expect(page.getByText(PLAIN_TEXT_MARKER).first()).toBeVisible({ timeout: 30_000 });
  });
});
