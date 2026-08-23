/**
 * L3 — the CLIENT surfaces of transport/identity, against the real harness.
 *
 * Every assertion here is on rendered DOM, because that is the only level at
 * which these four surfaces can fail. `movedTo` and `originDeviceId` are
 * server-set optional fields; a regression that drops them from the card is
 * invisible to every server test and to every component test that renders the
 * card with a hand-built session object.
 *
 * How a REMOTE session is produced: the spec runs on the HOST and reaches the
 * gateway through a published port, so the gateway sees the docker bridge
 * address rather than loopback and derives `originDeviceId` from the paired
 * device. That is not a simulation of a remote bridge — it IS one. The LOCAL
 * control in F3 is produced the only way a local origin can be: from inside
 * the container, over loopback.
 *
 * See change: add-pi-gateway-transport-identity
 * (test-plan #F1, #F2, #F3, #F4, #F5 → tasks 12.47, 12.48, 12.49, 12.50, 12.51).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

/** A transcript path need not exist — `sessionFile` only has to be SET for the
 *  resume affordance to be considered at all. F3 is about the origin gate in
 *  front of it, not about the file. */
const FAKE_SESSION_FILE = `${FIXTURE_GIT}/.e2e-origin-transcript.jsonl`;

// ── harness plumbing ────────────────────────────────────────────────────────

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

// ── remote bridge (host → published port → derives a remote origin) ─────────

/** Paired once per file: pairing is durable, tickets are not. */
let bearerPromise: Promise<string> | undefined;
function deviceBearer(): Promise<string> {
  bearerPromise ??= pairDeviceBearer(BASE_URL);
  return bearerPromise;
}

const openSockets: WebSocket[] = [];

/**
 * Register a session over the gateway from the host. The returned socket owns
 * the session id, so closing it ends the session exactly as a real bridge
 * going away does.
 */
async function registerRemoteSession(
  sessionId: string,
  extra: Record<string, unknown> = {},
): Promise<WebSocket> {
  const url = await gatewayUrlWithTicket(BASE_URL, await gatewayPort(), await deviceBearer());
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const sock = new WebSocket(url);
    // Cleared on settle — a live timer would hold the worker open past the
    // assertions and turn a fast failure into a hang.
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
      // The id doubles as the card NAME so `revealSession` can search for it.
      name: sessionId,
      cwd: FIXTURE_GIT,
      source: "tui",
      pid: 900000 + Math.floor(Math.random() * 90000),
      ...extra,
    }),
  );
  return ws;
}

/**
 * Register a session from INSIDE the container, over loopback, and end it.
 *
 * This is F3's local control: the tokenless-loopback grace applies, no
 * `originDeviceId` is derived, and the card must therefore behave exactly as
 * it always has.
 *
 * It ends the session by ANNOUNCING A MOVE rather than by dropping the socket,
 * for a timing reason that would otherwise make the spec unusable: a closed
 * bridge socket does not end a session for up to two 180 s heartbeat windows
 * (`HEARTBEAT_TIMEOUT`, not configurable), whereas `session_moved` sets
 * `status: "ended"` synchronously and keeps the card on the board. The
 * assertion is about the ORIGIN gate in front of resume, not about which of
 * the two roads reached the ended state.
 */
function endLocalSessionInContainer(sessionId: string, port: number): void {
  const script = [
    `const ws=new WebSocket("ws://127.0.0.1:${port}");`,
    `ws.addEventListener("open",()=>{`,
    `ws.send(JSON.stringify({type:"session_register",sessionId:"${sessionId}",`,
    `name:"${sessionId}",`,
    `cwd:"${FIXTURE_GIT}",source:"tui",pid:${800000 + Math.floor(Math.random() * 90000)},`,
    `sessionFile:"${FAKE_SESSION_FILE}"}));`,
    `setTimeout(()=>{ws.send(JSON.stringify({type:"session_moved",`,
    `instanceId:"e2e-local-control"}));`,
    `setTimeout(()=>{ws.close();process.exit(0);},1000);},1000);});`,
    `ws.addEventListener("error",(e)=>{console.error("ERR",String(e));process.exit(1);});`,
  ].join("");
  execFileSync("docker", ["exec", harnessContainer(), "node", "-e", script], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

function card(page: Page, sessionId: string) {
  return page.locator(
    `[data-testid="session-card-desktop"][data-session-id="${sessionId}"]`,
  );
}

/**
 * Bring ONE session's card into view, whatever its status.
 *
 * Load-bearing, not cosmetic. A folder collapses its ended sessions behind a
 * `folder-ended-toggle-<cwd>` control, so the moment a session ends its card
 * leaves the DOM entirely — and an absence assertion (F3's remote arm) would
 * then pass for the wrong reason. A non-empty session search auto-expands the
 * ended tier (`SessionList.tsx`: `sessionSearch.length > 0`), and searching for
 * the id — which each session also carries as its NAME — isolates exactly one
 * card in a container every other spec is also writing to.
 */
async function revealSession(page: Page, sessionId: string): Promise<void> {
  await page.getByTestId("session-search-input").fill(sessionId);
  await expect(card(page, sessionId)).toBeVisible({ timeout: 30_000 });
}

/**
 * Wait until the server actually considers the session ended.
 *
 * A closed bridge socket does NOT end a session synchronously — the card stays
 * `active` through a reconnect window. Asserting the resume affordance before
 * that settles reads the LIVE card, where resume is legitimately absent, and
 * the control arm fails for a reason that has nothing to do with origin.
 */
async function waitForEnded(page: Page, sessionId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/api/sessions")).json()) as {
          data?: Array<{ id: string; status?: string }>;
        };
        return (body.data ?? []).find((s) => s.id === sessionId)?.status;
      },
      { timeout: 90_000, intervals: [1_000] },
    )
    .toBe("ended");
}

/** Sessions from a closed socket stay on the board as ended cards; the sockets
 *  themselves must not outlive the test that opened them. */
test.afterEach(() => {
  while (openSockets.length) {
    try {
      openSockets.pop()?.close();
    } catch {
      // already closed — nothing to reclaim
    }
  }
});

/**
 * Pin the fixture directory over the BUS, not through the onboarding CTA.
 *
 * The UI helper cannot be used here. Its CTA only exists while the board is
 * empty, and it is gated on `providersReady` — so on the second test of a run
 * it waits 60 s for an affordance the first pin removed, and on a cold page it
 * can catch the button in its pre-providers disabled state. The pin is
 * container state that persists across specs, and `pin_directory` is
 * idempotent, so driving it directly is both simpler and order-independent.
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

test.beforeEach(async ({ page }) => {
  await gotoDashboard(page);
});

test.describe("remote origin + move, on the session card (L3)", () => {
  test("F5: a remote-origin session names its originating device (task 12.51)", async ({
    page,
  }) => {
    await ensureFixturePinned();
    const sessionId = `e2e-origin-${Date.now()}`;
    await registerRemoteSession(sessionId);

    await revealSession(page, sessionId);

    const chip = card(page, sessionId).getByTestId(`session-origin-${sessionId}`);
    await expect(chip, "a remote session must not be indistinguishable from a local one").toBeVisible(
      { timeout: 30_000 },
    );
    // Not merely present — it has to NAME the device. An empty chip is the
    // same operator experience as no chip.
    await expect(chip).not.toHaveText("");
  });

  test("F4: a move converges on the origin view with no reload (task 12.50)", async ({ page }) => {
    await ensureFixturePinned();
    const sessionId = `e2e-move-live-${Date.now()}`;
    const ws = await registerRemoteSession(sessionId);
    await revealSession(page, sessionId);

    // The page has been open across the whole move — nothing below reloads it.
    ws.send(
      JSON.stringify({
        type: "session_moved",
        instanceId: "e2e-target-instance",
        endpoint: "ws://elsewhere.invalid:8001",
      }),
    );

    await expect(
      card(page, sessionId).getByTestId(`session-moved-badge-${sessionId}`),
      "the origin view must reach 'moved' on its own",
    ).toBeVisible({ timeout: 30_000 });
  });

  test("F1: a moved session renders as moved, not as crashed (task 12.47)", async ({ page }) => {
    await ensureFixturePinned();
    const sessionId = `e2e-move-${Date.now()}`;
    const ws = await registerRemoteSession(sessionId);
    await revealSession(page, sessionId);

    ws.send(
      JSON.stringify({
        type: "session_moved",
        instanceId: "e2e-target-instance",
        endpoint: "ws://elsewhere.invalid:8001",
      }),
    );
    await expect(card(page, sessionId).getByTestId(`session-moved-badge-${sessionId}`)).toBeVisible({
      timeout: 30_000,
    });

    // Survives a reload: the badge is driven by persisted server state, not by
    // a transient frame the client happened to be listening for.
    await page.reload();
    await revealSession(page, sessionId);
    await expect(
      card(page, sessionId).getByTestId(`session-moved-badge-${sessionId}`),
      "the moved marker did not survive a reload — it is frame-driven, not state-driven",
    ).toBeVisible({ timeout: 30_000 });

    // And the server agrees this is an ended-with-a-destination, not a crash.
    const sessions = (await (await page.request.get("/api/sessions")).json()) as {
      data?: Array<{ id: string; status?: string; movedTo?: { instanceId?: string } }>;
    };
    const record = (sessions.data ?? []).find((s) => s.id === sessionId);
    expect(record, "the moved session left the board entirely").toBeTruthy();
    expect(record?.status).toBe("ended");
    expect(record?.movedTo?.instanceId).toBe("e2e-target-instance");
  });

  test("F3: an ended REMOTE session offers no resume, an ended LOCAL one does (task 12.49)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await ensureFixturePinned();
    const port = await gatewayPort();

    // ── control arm: local origin, same shape, resume MUST be offered ───────
    // Without this arm the remote assertion is vacuous: "no Resume button" also
    // holds if the affordance never renders for any ended session.
    const localId = `e2e-local-ended-${Date.now()}`;
    endLocalSessionInContainer(localId, port);
    await waitForEnded(page, localId);
    await revealSession(page, localId);
    const localCard = card(page, localId);
    await expect(
      localCard.getByRole("button", { name: /resume/i }),
      "the control arm never offered resume — the remote assertion below would prove nothing",
    ).toBeVisible({ timeout: 30_000 });

    // ── remote arm: same ended state, resume must be WITHHELD ──────────────
    const remoteId = `e2e-remote-ended-${Date.now()}`;
    const ws = await registerRemoteSession(remoteId, { sessionFile: FAKE_SESSION_FILE });
    await revealSession(page, remoteId);
    // Same road to `ended` as the control arm, so the two differ in ORIGIN and
    // in nothing else.
    ws.send(JSON.stringify({ type: "session_moved", instanceId: "e2e-remote-control" }));
    const remoteCard = card(page, remoteId);
    await expect(remoteCard.getByTestId(`session-origin-${remoteId}`)).toBeVisible({
      timeout: 30_000,
    });

    // Reach the ended tier before asserting an absence — asserting too early
    // passes for the wrong reason (a live card offers no resume either).
    await waitForEnded(page, remoteId);
    ws.close();
    await revealSession(page, remoteId);

    await expect(
      remoteCard.getByRole("button", { name: /resume/i }),
      "resume was offered for a session whose files live on another host (server answers 409)",
    ).toHaveCount(0);
    await expect(
      remoteCard.getByRole("button", { name: /^fork$/i }),
      "fork was offered for a remote-origin session",
    ).toHaveCount(0);
  });
});

test.describe("gateway transport, on the settings surface (L3)", () => {
  test("F2: settings reports the LIVE bridge endpoint (task 12.48)", async ({ page }) => {
    // The Ports section lives on the Server page, not on Settings' landing tab.
    await page.goto("/settings/server");
    const readout = page.getByTestId("gateway-transport-live");
    await expect(readout).toBeVisible({ timeout: 30_000 });

    const health = (await (await page.request.get("/api/health")).json()) as {
      piGatewayPort?: number | string | null;
    };
    const live = health.piGatewayPort;
    const expectedTransport = typeof live === "string" ? "unix" : live === null ? "none" : "tcp";

    // The readout must agree with what is actually bound. The bug it guards is
    // the CONFIGURED port field advertising a listener that does not exist.
    await expect(readout).toHaveAttribute("data-transport", expectedTransport);
    if (live !== null && live !== undefined) {
      await expect(readout, "the live endpoint rendered blank").toContainText(String(live));
    }

    // LIMITATION, stated rather than implied. This harness publishes a TCP
    // gateway, so the arm that runs here is the `tcp` one. The `unix` branch —
    // `address()` returning a socket PATH rather than a number, which is the
    // shape task 2.9 exists to survive — is covered at L1 and is NOT proven by
    // this spec. Proving it at L3 needs a harness whose gateway is
    // socket-only, which the published-port harness cannot be.
    expect(expectedTransport).toBe("tcp");
  });
});
