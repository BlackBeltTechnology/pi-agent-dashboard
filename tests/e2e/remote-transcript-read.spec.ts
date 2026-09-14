/**
 * L3 — history predating the attach actually renders.
 *
 * This is the scenario `add-pi-gateway-transport-identity` deferred as 12.52,
 * and the struck clause of its 13.5. It could not be written then because the
 * read half did not exist: `RemoteTranscriptStore.read()` had no caller and no
 * route, so a spec asserting "retained history renders" would have been
 * asserting a fiction. It exists now, so the assertion is real.
 *
 * How the history is produced: the spec runs on the HOST and reaches the
 * gateway through a published port, so the gateway sees the docker bridge
 * address rather than loopback and derives `originDeviceId` from the paired
 * device — the session is genuinely remote-origin, not a simulation of one.
 * The transcript is then delivered over that same socket as a REAL
 * `transcript_chunk` frame, which is the actual acquisition path. Nothing here
 * plants a file; every byte travels the road it travels in production.
 *
 * Three properties, one per spec-delta scenario:
 *
 *   - retained entries come back in their original order, and RENDER;
 *   - an unfinished transfer is reported as incomplete and is visibly
 *     distinguished from a session with no history at all;
 *   - the read refuses a caller-supplied path instead of resolving it.
 *
 * The route is `networkGuard`ed, so every direct fetch below carries the
 * harness's local token (read out of the container). The guard itself is NOT
 * asserted here: docker publishes the port through a proxy, so the server sees
 * a host request as loopback and exempts it — the known-guarded sibling
 * `/api/session-file` answers an unauthenticated host request too. An L3
 * "guard refuses" arm would therefore assert something this harness cannot
 * produce. The wiring is pinned instead by a spy preHandler in
 * `packages/server/src/__tests__/retained-transcript-route.test.ts`.
 *
 * The BROWSER arms carry no token deliberately: a browser never calls this
 * route — it gets retained history through subscribe-time hydration — and
 * those arms would stop proving that if they authenticated.
 *
 * See change: serve-retained-remote-transcripts (tasks 3.1, 3.2).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { expect, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

// ── harness plumbing (same shape as gateway-origin-surfaces.spec.ts) ────────

let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const state = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8"),
  ) as { project?: string };
  if (!state.project) throw new Error(".pi-test-harness.json carries no compose project");
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${state.project}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  containerId = id;
  return id;
}

async function gatewayPort(): Promise<number> {
  const health = (await (await fetch(`${BASE_URL}/api/health`)).json()) as {
    piGatewayPort?: number | string | null;
  };
  const port = health.piGatewayPort;
  if (typeof port !== "number") {
    throw new Error(`harness gateway is not on a TCP port (got ${JSON.stringify(port)})`);
  }
  return port;
}

let bearerPromise: Promise<string> | undefined;
function deviceBearer(): Promise<string> {
  bearerPromise ??= pairDeviceBearer(BASE_URL);
  return bearerPromise;
}

const openSockets: WebSocket[] = [];

/** The origin-host path every remote session below records. */
const DECOY_SESSION_FILE = `${FIXTURE_GIT}/.e2e-remote-origin.jsonl`;
/** Text that exists ONLY in the decoy. Rendering it means the local file was read. */
const DECOY_MARKER = "DECOY-LOCAL-TRANSCRIPT-MUST-NOT-RENDER";

/**
 * Plant a real, parseable transcript at the path the remote sessions record.
 *
 * Without this the #E15 assertion is vacuous: a regression to disk hydration
 * would fail only because the file happened to be MISSING, which proves nothing
 * about the gate. With it, disk hydration renders `DECOY_MARKER` and the
 * assertion has something to catch.
 */
function plantDecoyTranscript(): void {
  const lines = [
    { type: "session", id: "decoy", timestamp: "2025-01-01T00:00:00Z", cwd: FIXTURE_GIT },
    {
      type: "message",
      id: "d1",
      parentId: null,
      timestamp: "2025-01-01T00:00:01Z",
      message: { role: "user", content: DECOY_MARKER },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");
  execFileSync(
    "docker",
    [
      "exec",
      harnessContainer(),
      "node",
      "-e",
      `require("fs").writeFileSync(${JSON.stringify(DECOY_SESSION_FILE)}, ${JSON.stringify(`${lines}\n`)})`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
}

async function openRemoteBridge(sessionId: string): Promise<WebSocket> {
  const url = await gatewayUrlWithTicket(BASE_URL, await gatewayPort(), await deviceBearer());
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error("gateway open timeout")), 10_000);
    sock.addEventListener("open", () => { clearTimeout(timer); resolve(sock); }, { once: true });
    sock.addEventListener(
      "error",
      () => { clearTimeout(timer); reject(new Error("gateway socket error")); },
      { once: true },
    );
  });
  openSockets.push(ws);
  ws.send(
    JSON.stringify({
      type: "session_register",
      sessionId,
      name: sessionId,
      cwd: FIXTURE_GIT,
      source: "tui",
      pid: 910000 + Math.floor(Math.random() * 80000),
      // A path on the ORIGIN host. Deliberately set, and a DECOY transcript is
      // planted there (see `plantDecoyTranscript`): the point of the retained
      // read is that hydration must not reach for this even when a file of the
      // same name really does exist on this host — which is the #E15 shape,
      // two machines with the same username producing the same path.
      sessionFile: DECOY_SESSION_FILE,
    }),
  );
  return ws;
}

/**
 * A REAL pi transcript. `parentId` chains the entries so the server resolves
 * the same branch the origin machine would — a linear-order shortcut would
 * make this spec pass against a reader that renders a different conversation.
 */
function transcriptLines(marker: string): string[] {
  return [
    { type: "session", id: "sess-e2e", timestamp: "2025-01-01T00:00:00Z", cwd: FIXTURE_GIT },
    {
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2025-01-01T00:00:01Z",
      message: { role: "user", content: `${marker}-FIRST` },
    },
    {
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: "2025-01-01T00:00:02Z",
      message: { role: "assistant", content: [{ type: "text", text: `${marker}-SECOND` }] },
    },
  ].map((e) => JSON.stringify(e));
}

/** Deliver a transcript the way a joining bridge delivers one. */
function sendTranscript(ws: WebSocket, sessionId: string, lines: string[], complete: boolean): void {
  ws.send(
    JSON.stringify({
      type: "transcript_chunk",
      sessionId,
      entries: lines,
      complete,
      restarted: true,
    }),
  );
}

/**
 * The harness's local-IPC token, read from inside the container.
 *
 * `networkGuard` exempts a genuinely-loopback peer or an affirmative token.
 * These specs run on the HOST and arrive over the published port, so the peer
 * is the docker bridge, not loopback — the token is the only way in, and
 * needing it is the point.
 */
let localTokenCache: string | undefined;
function localToken(): string {
  if (localTokenCache) return localTokenCache;
  const token = execFileSync(
    "docker",
    [
      "exec",
      harnessContainer(),
      "node",
      "-e",
      'process.stdout.write(require("fs").readFileSync(require("path").join(process.env.HOME, ".pi/dashboard/local/token"), "utf8").trim())',
    ],
    { encoding: "utf8", timeout: 60_000 },
  ).trim();
  if (!token) throw new Error("harness has no local token");
  localTokenCache = token;
  return token;
}

/** Fetch the retained-transcript route; token-bearing unless told otherwise. */
async function retainedFetch(
  sessionId: string,
  opts: { query?: string; withToken?: boolean } = {},
): Promise<Response> {
  const url = `${BASE_URL}/api/sessions/${sessionId}/retained-transcript${opts.query ?? ""}`;
  return fetch(url, {
    headers: opts.withToken === false ? {} : { "x-pi-local-token": localToken() },
  });
}

/**
 * Pin the fixture directory over the BUS. The onboarding CTA only exists while
 * the board is empty, so driving it would be order-dependent; `pin_directory`
 * is idempotent. (Same rationale as gateway-origin-surfaces.spec.ts.)
 */
async function ensureFixturePinned(): Promise<void> {
  const client = new BusClient({ host: "localhost", port: DASHBOARD_PORT });
  await client.connect();
  try {
    client.send({ type: "pin_directory", path: FIXTURE_GIT } as never);
    await new Promise((r) => setTimeout(r, 1_000));
  } finally {
    client.close();
  }
}

/** Wait until the server has actually retained what the bridge sent. */
async function waitForRetention(
  sessionId: string,
  want: "complete" | "incomplete" | "absent",
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await retainedFetch(sessionId);
        if (!res.ok) return `http-${res.status}`;
        const body = (await res.json()) as { data?: { state?: string } };
        return body.data?.state;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(want);
}

test.afterEach(() => {
  while (openSockets.length) {
    try {
      openSockets.pop()?.close();
    } catch {
      // already closed — nothing to reclaim
    }
  }
});

test.describe("retained remote transcripts are served (L3)", () => {
  test.setTimeout(180_000);

  test("history predating the attach is served, in order, and renders", async ({ page }) => {
    await ensureFixturePinned();
    const sessionId = `e2e-retained-${Date.now()}`;
    const marker = `RETAINED${Date.now()}`;
    const lines = transcriptLines(marker);

    plantDecoyTranscript();
    const ws = await openRemoteBridge(sessionId);
    // Nothing about this session is live: every message below predates any
    // browser attachment, which is precisely the history that used to be
    // unreachable.
    sendTranscript(ws, sessionId, lines, true);
    await waitForRetention(sessionId, "complete");

    // ── the route serves the entries verbatim, in the origin's order ───────
    const res = await retainedFetch(sessionId);
    expect(res.ok).toBeTruthy();
    const body = (await res.json()) as { data?: { entries?: string[]; state?: string } };
    expect(body.data?.entries, "the retained entries were not served back").toEqual(lines);
    expect(body.data?.state).toBe("complete");

    // ── and it RENDERS: the read is wired to the transcript, not stranded ──
    // This is the half 12.52 could not assert. A route that returns bytes
    // nobody displays is the same user experience as no route at all.
    await gotoDashboard(page);
    await page.goto(`/session/${sessionId}`);
    await expect(page.getByText(`${marker}-FIRST`).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(`${marker}-SECOND`).first()).toBeVisible({ timeout: 60_000 });
    // Whole conversation → no truncation warning.
    await expect(page.getByTestId("retained-transcript-incomplete")).toHaveCount(0);
    // #E15, asserted POSITIVELY: a real file sits at the recorded `sessionFile`
    // path on THIS host, and none of it reached the screen.
    await expect(
      page.getByText(DECOY_MARKER),
      "hydration read the recorded sessionFile off the local disk (#E15)",
    ).toHaveCount(0);
  });

  test("an unfinished transfer is reported incomplete and says so on screen", async ({ page }) => {
    await ensureFixturePinned();
    const sessionId = `e2e-partial-${Date.now()}`;
    const marker = `PARTIAL${Date.now()}`;
    const lines = transcriptLines(marker);

    const ws = await openRemoteBridge(sessionId);
    // A bridge that died mid-transfer: the frames that arrived are real, and
    // there were more. Presenting this as the whole conversation is the
    // failure being guarded.
    sendTranscript(ws, sessionId, lines.slice(0, 2), false);
    await waitForRetention(sessionId, "incomplete");

    await gotoDashboard(page);
    await page.goto(`/session/${sessionId}`);
    // What arrived is still shown — a partial conversation beats a blank one.
    await expect(page.getByText(`${marker}-FIRST`).first()).toBeVisible({ timeout: 60_000 });
    // …but never as if it were everything.
    await expect(
      page.getByTestId("retained-transcript-incomplete"),
      "a truncated transfer rendered as if it were the whole conversation",
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a session with NO retained history is not warned about", async ({ page }) => {
    // The control for the test above: without it, "shows a warning" would also
    // pass for an implementation that warns on every remote session, which
    // would make the warning meaningless exactly when it matters.
    await ensureFixturePinned();
    const sessionId = `e2e-nohistory-${Date.now()}`;
    await openRemoteBridge(sessionId);
    await waitForRetention(sessionId, "absent");

    await gotoDashboard(page);
    await page.goto(`/session/${sessionId}`);
    await expect(page.getByTestId("retained-transcript-incomplete")).toHaveCount(0);
  });

  test("the read refuses a caller-supplied path instead of resolving it", async () => {
    const sessionId = `e2e-pathprobe-${Date.now()}`;
    const ws = await openRemoteBridge(sessionId);
    sendTranscript(ws, sessionId, transcriptLines("PROBE"), true);
    await waitForRetention(sessionId, "complete");

    for (const field of ["path", "file", "sessionFile", "cwd"]) {
      const res = await retainedFetch(sessionId, {
        query: `?${field}=${encodeURIComponent("../../../../etc/passwd")}`,
      });
      expect(res.status, `a '${field}' field was not refused`).toBe(400);
      const body = (await res.json()) as { success?: boolean; error?: string };
      expect(body.success).toBe(false);
      // And nothing off-disk came back with it.
      expect(JSON.stringify(body)).not.toContain("root:");
    }
  });

  test("a LOCAL-origin session is refused, so this is not a second local read", async () => {
    // The route's other boundary (task 1.3). Every session the harness spawns
    // from inside the container is local-origin; the dashboard's own listing is
    // the cheapest way to find one.
    const sessions = (await (await fetch(`${BASE_URL}/api/sessions`)).json()) as {
      data?: Array<{ id: string; originDeviceId?: string }>;
    };
    const local = (sessions.data ?? []).find((s) => !s.originDeviceId);
    test.skip(!local, "no local-origin session on the board to use as the control");

    const res = await retainedFetch(local!.id);
    expect(res.status, "a local session's files were reachable through the remote read").toBe(403);
  });

});
