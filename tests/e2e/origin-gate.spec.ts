/**
 * L3 — the cross-site gates in BROWSER reality (issue #625, test-plan #F1–#F3).
 *
 * The L1 suites drive the handlers with a `ws` client and `fastify.inject`,
 * which pins the decision but not the thing the issue is about: a real page, on
 * a real foreign origin, in a real browser, carrying the browser's own `Origin`.
 *
 * The attacker page is served by a LOCAL http server and reached through
 * `--host-resolver-rules=MAP attacker.test 127.0.0.1`, deliberately NOT through
 * `page.route` fulfilment. A fulfilled route has no resolved IP, so Chrome
 * files the page under the PUBLIC address space and its own Private Network
 * Access check blocks the request before it ever leaves the browser — the
 * assertion would then pass while proving nothing about the server. Resolving
 * the hostile origin to 127.0.0.1 puts both sides in the LOCAL address space,
 * PNA stands down, and the request reaches the gate, which is what is under
 * test. (PNA is also absent from non-Chromium browsers, so it is not a server
 * guarantee in the first place.)
 *
 * F1 is the other half, and the one that fails loudly if the gate over-reaches:
 * the dashboard's own page must still open its socket, with no `[ws-gate]` line.
 *
 * Exemplars: `csp.spec.ts` (harness attach), `keeper-log-health.spec.ts`
 * (reading harness state via `docker exec`).
 *
 * See change: fix-ws-origin-cswsh (tasks 5.2–5.4).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { BASE_URL, DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

/** The hostile origin, resolved to loopback by the launch arg below. */
const ATTACKER_HOST = "attacker.test";

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${ATTACKER_HOST} 127.0.0.1`] },
});

/** The harness container id, resolved from the recorded compose project. */
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

/** The dashboard's own log — where a `console.error` from the gates lands. */
function harnessLog(): string {
  return execFileSync(
    "docker",
    ["exec", harnessContainer(), "sh", "-c", 'cat "$HOME/.pi/dashboard/server.log" 2>/dev/null || true'],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
}

/**
 * Poll the log for `needle`. The gate's `console.error` reaches the file a beat
 * after the socket dies, so a single read races the flush — and this line is
 * the discriminator between "the gate refused it" and "the browser did".
 */
async function waitForLogLine(needle: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let log = "";
  while (Date.now() < deadline) {
    log = harnessLog();
    if (log.includes(needle)) return log;
    await new Promise((r) => setTimeout(r, 500));
  }
  return log;
}

let attackerServer: http.Server;
let attackerOrigin: string;

test.beforeAll(async () => {
  attackerServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><html><body><h1>attacker</h1></body></html>");
  });
  await new Promise<void>((resolve) => attackerServer.listen(0, "127.0.0.1", resolve));
  const { port } = attackerServer.address() as { port: number };
  attackerOrigin = `http://${ATTACKER_HOST}:${port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => attackerServer.close(() => resolve()));
});

test.describe("cross-site request gate", () => {
  // #F2 — the first hop of the #625 chain, from a real foreign origin.
  test("a hostile page cannot open the dashboard WebSocket", async ({ page }) => {
    await page.goto(`${attackerOrigin}/`);

    const outcome = await page.evaluate(
      ([port]) =>
        new Promise<{ opened: boolean; errored: boolean; text: string }>((resolve) => {
          const ws = new WebSocket(`ws://localhost:${port}/ws`);
          let text = "";
          const done = (r: { opened: boolean; errored: boolean }) => resolve({ ...r, text });
          ws.onmessage = (e) => {
            text += String(e.data);
          };
          ws.onopen = () => setTimeout(() => done({ opened: true, errored: false }), 1500);
          ws.onerror = () => done({ opened: false, errored: true });
          setTimeout(() => done({ opened: ws.readyState === WebSocket.OPEN, errored: false }), 8000);
        }),
      [String(DASHBOARD_PORT)] as const,
    );

    expect(outcome.opened, "the hostile socket must never open").toBe(false);
    expect(outcome.errored).toBe(true);
    expect(outcome.text).not.toContain("sessions_snapshot");

    const needle = `[ws-gate] rejected upgrade origin=${attackerOrigin}`;
    expect(await waitForLogLine(needle)).toContain(needle);
  });

  // #F3 — the blind-CSRF half: the request is refused, not merely unreadable.
  test("a hostile page cannot drive a mutating /api/ route", async ({ page, request }) => {
    await page.goto(`${attackerOrigin}/`);

    const before = await (await request.get(`${BASE_URL}/api/tunnel-status`)).text();

    await page.evaluate(
      ([port]) =>
        fetch(`http://localhost:${port}/api/tunnel-connect`, {
          method: "POST",
          mode: "no-cors",
        }).catch(() => undefined),
      [String(DASHBOARD_PORT)] as const,
    );
    await page.waitForTimeout(2_000);

    const after = await (await request.get(`${BASE_URL}/api/tunnel-status`)).text();
    expect(after, "the refused mutation must not have changed tunnel state").toBe(before);

    const needle = `[csrf-gate] rejected POST /api/tunnel-connect origin=${attackerOrigin}`;
    expect(await waitForLogLine(needle)).toContain(needle);
  });

  // #F1 — the dashboard's own client is untouched: its page opens the very
  // socket the gate refuses above, and trips no rejection.
  test("the dashboard's own page still opens its WebSocket", async ({ page }) => {
    const before = harnessLog().length;

    await page.goto(`${BASE_URL}/`);
    const connected = await page.evaluate(
      ([port]) =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket(`ws://localhost:${port}/ws`);
          ws.onmessage = (e) => resolve(String(e.data).includes("sessions_snapshot"));
          ws.onerror = () => resolve(false);
          setTimeout(() => resolve(false), 10_000);
        }),
      [String(DASHBOARD_PORT)] as const,
    );

    expect(connected, "the dashboard's own origin must still reach /ws").toBe(true);
    expect(harnessLog().slice(before)).not.toContain("[ws-gate]");
  });
});
