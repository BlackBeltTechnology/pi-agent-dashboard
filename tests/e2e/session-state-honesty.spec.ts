/**
 * L3 — the three rendered-UI scenarios for
 * change: stop-discarding-known-session-state (test-plan Q1, Q2, Q3).
 *
 * Q1 is the incident this change exists for: a prompt typed while the dashboard
 * socket is down must fail HONESTLY and attribute the failure to the
 * connection, never to the session. The client queues a non-open send and flushes
 * it on reconnect; if the reconnect never lands inside the outbox window the
 * queued prompt is reported undelivered (`markPromptUndelivered`) instead of
 * ageing into the 30 s "may not have been received" wording.
 *
 * The cut is a HARD-offline simulation (`armHardOffline`): neither
 * `context.setOffline(true)` (does not close an established socket) nor
 * `routeWebSocket` (its mocked reconnect still fires `onopen`, resetting the
 * app's backoff) can hold the client disconnected for the 10 s outbox window.
 *
 * Q2 kills a session's process OUT OF BAND (the container's `/proc`, via
 * `docker exec` — nothing in the dashboard's own bookkeeping) and asserts the
 * rendered card names a reason rather than a bare `ended`.
 *
 * Q3 is the zero-pixel contract: a HEALTHY live card renders no pressure pill
 * (mockups/ui-plan.md Surface 2). The precondition — the row really is carrying
 * a fresh heartbeat — is asserted from `/api/sessions` so the absence cannot
 * pass vacuously on an `unknown` (never-reported) row.
 *
 * Exemplars: `tests/e2e/tmux-session-shutdown.spec.ts` (container resolution +
 * out-of-band kill + `BusClient`), `tests/e2e/optimistic-prompt.spec.ts` (real
 * prompt round-trip through the faux model).
 *
 * Harness port + compose project come from `.pi-test-harness.json`; never
 * hardcode :18000.
 */

import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/** The `closedReason` vocabulary, mirrored from shared types. */
const CLOSED_REASONS = ["manual", "process_gone", "spawn_failed", "unknown"] as const;

/**
 * Resolve the harness container by the dashboard port it publishes. Port-derived
 * because `test-up.sh` hash-derives a per-worktree compose project, so the
 * container name is not knowable here.
 */
function resolveContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function inContainer(container: string, script: string): string {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/**
 * Put the browser into a HARD-offline state on demand, for the Q1 cut.
 *
 * `context.setOffline(true)` does NOT close an already-established WebSocket
 * (measured against this harness: the app simply stays `connected`), and a
 * `routeWebSocket` reconnect still fires the page's `onopen`, which resets the
 * app's backoff and status — so neither holds the client disconnected for the
 * outbox window. This wrapper throws from the `WebSocket` constructor once
 * `__cutDashboardWs` is set (exactly what a browser with no network does) and
 * exposes the live sockets so the established one can be closed. `useWebSocket`
 * catches the constructor throw, flips to a non-connected status, and schedules
 * NO further reconnect.
 */
async function armHardOffline(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const Real = window.WebSocket;
    const w = window as unknown as {
      __dashSockets: WebSocket[];
      __cutDashboardWs?: boolean;
      WebSocket: typeof WebSocket;
    };
    w.__dashSockets = [];
    const Wrapped = function (url: string, protocols?: string | string[]) {
      if (w.__cutDashboardWs) throw new Error("simulated offline");
      const socket = protocols === undefined ? new Real(url) : new Real(url, protocols);
      w.__dashSockets.push(socket);
      return socket;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = Real.prototype;
    Object.assign(Wrapped, Real);
    w.WebSocket = Wrapped;
  });
}

/** Close the established dashboard socket and block every reconnect. */
async function cutTransport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __dashSockets: WebSocket[]; __cutDashboardWs?: boolean };
    w.__cutDashboardWs = true;
    for (const socket of w.__dashSockets) {
      try {
        socket.close();
      } catch {
        // already gone
      }
    }
  });
}

interface ServerSessionRecord {
  id: string;
  cwd?: string;
  status?: string;
  pid?: number;
  closedReason?: string;
  processMetrics?: { updatedAt?: number };
}

/** The server's OWN record view (`sessionManager.listAll()`) — the full record,
 *  read for `cwd`/`pid`/`closedReason`/`processMetrics` without depending on any
 *  browser-facing row projection. */
async function serverRecord(sessionId: string): Promise<ServerSessionRecord | undefined> {
  const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/sessions`);
  const body = (await res.json()) as { data?: ServerSessionRecord[] };
  return body.data?.find((s) => s.id === sessionId);
}

test.describe("stop-discarding-known-session-state — rendered honesty (L3)", () => {
  test("Q1: a prompt sent while the socket is down fails honestly and is not blamed on the session", async ({
    page,
  }) => {
    // The outbox window is 10 s; allow generous slack for the desktop banner
    // plus a loaded container.
    test.setTimeout(120_000);

    await armHardOffline(page);

    const card = await spawnFreshGitSession(page);
    await card.click();
    const composer = page.getByPlaceholder(/message/i).first();
    await composer.waitFor({ state: "visible", timeout: 30_000 });

    // Cut the transport: the established socket closes and every reconnect
    // throws, so the next `send` hits a non-OPEN socket and queues.
    await cutTransport(page);

    // Deterministic precondition: the desktop shell's OWN connection banner
    // ("Connecting…" / "Server offline" — NOT the mobile ConnectionStatusBanner,
    // which is not mounted in this shell) proves the client has left the
    // connected state BEFORE we type, so the prompt cannot be handed to a live
    // socket and silently vanish. The prompt path is the reported symptom.
    await expect(page.getByText(/Connecting\.\.\.|Server offline/).first()).toBeVisible({
      timeout: 15_000,
    });

    await sendPrompt(page, "q1 offline probe — this must not vanish silently");

    const bubble = byTestId(page, "pendingPromptCard");
    // The honest failure lands when the outbox entry expires (10 s), well
    // inside the 30 s safety deadline the old lie fired at.
    await expect(bubble).toHaveAttribute("data-status", "failed", { timeout: 25_000 });
    await expect(page.getByTestId("pending-prompt-failed")).toBeVisible();

    // Attribution is the whole point: the CONNECTION is blamed, and the
    // session-ambiguity wording reserved for the genuinely-unknown case is
    // NOT what the user sees.
    await expect(bubble).toContainText("Dashboard is offline");
    await expect(bubble).not.toContainText("may not have been received");
    // A marked exit (Nielsen #3), not a dead end.
    await expect(bubble.getByRole("button", { name: /retry/i })).toBeVisible();
  });

  test("Q2: an out-of-band process kill ends the card with a reason, not a bare ended", async ({
    page,
  }) => {
    // The only server-side path that can classify an involuntary death is the
    // gateway reconnect-grace expiry: HEARTBEAT_TIMEOUT (180 s) + one grace
    // period (180 s) — MEASURED at 361 s against this harness. Bound generously
    // rather than asserting a shorter number.
    test.setTimeout(520_000);

    const container = resolveContainer();
    const card = await spawnFreshGitSession(page);
    const sessionId = (await card.getAttribute("data-session-id")) as string;
    expect(sessionId, "the spawned card carries no data-session-id").toBeTruthy();

    const record = await serverRecord(sessionId);
    const pid = record?.pid;
    // The session's OWN cwd, not FIXTURE_GIT: `spawnFreshGitSession` clicks the
    // FIRST sidebar folder's "New Session", and the seeded harness has many
    // fixture folders — so the card may not live under `sample-git` at all.
    const cwd = record?.cwd;
    expect(typeof cwd, "the server recorded no cwd for the spawned session").toBe("string");
    expect(typeof pid, "the server recorded no PID for the spawned session").toBe("number");
    expect(
      inContainer(container, `[ -d /proc/${pid} ] && echo yes || echo no`),
      "the session process was not resident before the kill",
    ).toBe("yes");

    // Out of band: nothing in the dashboard's own state is touched, so any
    // reason that appears was derived by the server from the death itself.
    inContainer(container, `kill -9 ${pid}`);

    // Poll the SERVER record first — it is the ground truth the rendered pill
    // mirrors, and a failure here is unambiguous (attribution never happened).
    let reason: string | undefined;
    await expect
      .poll(
        async () => {
          const rec = await serverRecord(sessionId);
          if (rec?.status !== "ended" || !rec.closedReason) return `${rec?.status}:${rec?.closedReason}`;
          reason = rec.closedReason;
          return "ended-with-reason";
        },
        { timeout: 440_000, intervals: [5_000] },
      )
      .toBe("ended-with-reason");

    expect(
      CLOSED_REASONS.includes(reason as (typeof CLOSED_REASONS)[number]),
      `closedReason was "${reason}" — a death outside the vocabulary`,
    ).toBe(true);
    // `manual` would mean the dashboard thought the user closed it.
    expect(reason, "an out-of-band kill must not be labelled as a manual close").not.toBe("manual");

    // ...and the RENDERED card names the reason. Ended cards live behind the
    // per-folder "N ended" toggle (collapsed by default), so expand it first.
    const toggle = page.getByTestId(`folder-ended-toggle-${cwd}`);
    await toggle.waitFor({ state: "visible", timeout: 30_000 });
    if (((await toggle.getAttribute("aria-label")) ?? "").startsWith("Show")) {
      await toggle.click();
    }
    const pill = page.locator(`[data-testid="session-ended-reason-${sessionId}"]`);
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toHaveAttribute("data-closed-reason", reason as string);
  });

  test("Q3: a healthy live card renders no host-pressure pill (zero added pixels)", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    expect(sessionId, "the spawned card carries no data-session-id").toBeTruthy();

    // Precondition, polled: the row must be LIVE and carrying a FRESH heartbeat,
    // or the absent pill below would only prove "unknown", not "healthy".
    await expect
      .poll(
        async () => {
          const rec = await serverRecord(sessionId as string);
          if (!rec || rec.status === "ended") return `ended:${rec?.status}`;
          const updatedAt = rec.processMetrics?.updatedAt;
          if (typeof updatedAt !== "number") return "no-metrics";
          return Date.now() - updatedAt < 35_000 ? "healthy" : `stale:${Date.now() - updatedAt}`;
        },
        { timeout: 60_000 },
      )
      .toBe("healthy");

    // The zero-pixel contract: healthy is SILENT (mockup Surface 2). The pill
    // exists in the DOM only for degraded/unresponsive.
    await expect(page.locator(`[data-testid="session-host-pressure-${sessionId}"]`)).toHaveCount(0);
    // The card itself is still present — the absence above is silence, not a
    // vanished card.
    await expect(card).toBeVisible();
  });
});
