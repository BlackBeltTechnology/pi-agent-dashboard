/**
 * E2E: add-access-provisioning, tasks 5.3-5.10 (test-plan #F1, #F2, #F4, #F5,
 * #F6, #X9, #X11, #X12).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the registry, the routes, the gateway wiring and every React
 * surface in jsdom. Only a REAL browser against the REAL server shows that a
 * request the AGENT proposes over HTTP reaches every capability-holding browser,
 * that the first answer converges on all of them, that a dropped socket
 * reconciles, that closing the last operator browser leaves the request pending,
 * and that an approved folder really stops a real session's read from prompting
 * while a rejected one still does.
 *
 * WHO IS WHO
 * ----------
 * - The AGENT is the test's `request` fixture: an operate-tier HTTP caller that
 *   holds no prompt capability, so it can propose but can never settle.
 * - An OPERATOR is a browser context: the gateway issues it a capability over the
 *   WebSocket and the page's own `fetch` echoes it. `openOperator` waits for that
 *   capability before returning (the Access page's read-only banner is the signal).
 *
 * HARNESS STATE
 * -------------
 * Provisioning needs `hostGate.mode = "enforce"` and `accessGrants.promptEnabled`
 * (design D7); `beforeAll` sets both (`narrowTrust` for the trust-bearing key, a
 * raw in-container write for the other) and `afterAll` restores `config.json`.
 * Every folder and project root a test uses lives under `BASE`, one directory per
 * test, so D6's per-root rate limit and cooldown never leak between tests. Grants a
 * test creates are revoked through the real revoke route in `afterEach`, and any
 * request still pending is dismissed, so no test inherits another's dialog.
 *
 * GLOBAL RATE LIMIT
 * -----------------
 * D6 allows 3 creations per 10 minutes per server process and the registry is in
 * memory. This file creates 8, so `ensureBudget` restarts the dashboard server
 * (the pi sessions survive) whenever the next test would exceed the budget.
 * That is the only reset the product offers; it is not a test-only knob.
 *
 * THE ACCESS PAGE BEHIND THE DIALOG
 * ---------------------------------
 * A capability-holding browser raises the provisioning dialog for every pending
 * request, including on `/settings/access`, and that dialog is modal. The Access
 * page's own controls (#F2, #F4) are therefore covered by the overlay. A normal
 * `click()` would never land and `click({force:true})` would hit the BACKDROP,
 * which rejects the request. `pressBehindDialog` dispatches the click straight to
 * the control, so the page's real handler and the real server route run, but it
 * does not prove a human can reach the control past the dialog. Reported with the
 * change.
 *
 * See change: add-access-provisioning.
 */
import { execSync } from "node:child_process";
import type { Browser, Locator, Page, WebSocketRoute } from "@playwright/test";
import { type APIRequestContext, expect, narrowTrust, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/** Everything the spec creates lives here (pi-owned, outside every session root). */
const BASE = "/srv/fixtures-outside/__prov-e2e__";
const LINES = `${BASE}/lines`;
const ROOTS = `${BASE}/roots`;
/** The two folders `qa/fixtures/faux-scenarios.ts` `tool-read-provisioned` reads. */
const LIB = `${LINES}/lib`;
const OTHER = `${LINES}/other`;

const CONFIG = "/home/pi/.pi/dashboard/config.json";
/** D6: creations per process per 10 minutes. */
const GLOBAL_RATE_MAX = 3;

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}

/** Run a node script in the container (as its default user) and return stdout. */
function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

/** Merge `patch` into the container's config.json (top-level keys, atomic). */
function patchConfig(patch: Record<string, unknown>): void {
  inContainer(`
    const fs = require("node:fs");
    const p = ${JSON.stringify(CONFIG)};
    const cur = JSON.parse(fs.readFileSync(p, "utf8"));
    const patch = ${JSON.stringify(patch)};
    for (const [k, v] of Object.entries(patch)) {
      cur[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(cur[k] ?? {}), ...v } : v;
    }
    fs.writeFileSync(p + ".e2e.tmp", JSON.stringify(cur, null, 2));
    fs.renameSync(p + ".e2e.tmp", p);
  `);
}

/** A project root the agent may claim: holds `.git`. Unique per test (D6 per-root limits). */
function seedRoot(name: string): string {
  const root = `${ROOTS}/${name}`;
  inContainer(`require("node:fs").mkdirSync(${JSON.stringify(`${root}/.git`)}, { recursive: true });`);
  return root;
}

/** A folder the agent asks for, holding a readable `x.txt`. */
function seedFolder(dir: string): string {
  inContainer(`
    const fs = require("node:fs");
    fs.mkdirSync(${JSON.stringify(dir)}, { recursive: true });
    fs.writeFileSync(${JSON.stringify(`${dir}/x.txt`)}, "provisioned\\n");
  `);
  return dir;
}

interface ProposeReply {
  success: boolean;
  error?: string;
  requestId?: string;
  data?: { requestId: string; status: string };
}

interface RequestBody {
  projectRoot: string;
  lines: { path: string; why?: string }[];
  remote?: string[];
}

/** The agent's POST (no capability header). Returns the status and parsed body. */
async function propose(
  request: APIRequestContext,
  body: RequestBody,
): Promise<{ status: number; body: ProposeReply }> {
  const res = await request.post("/api/access/provision", { data: body });
  return { status: res.status(), body: (await res.json()) as ProposeReply };
}

/** `propose`, retried while the only thing missing is an operator socket still connecting. */
async function proposeWhenOperatorReady(
  request: APIRequestContext,
  body: RequestBody,
): Promise<string> {
  let last: { status: number; body: ProposeReply } | undefined;
  await expect
    .poll(
      async () => {
        last = await propose(request, body);
        return last.status === 409 && last.body.error === "no-operator" ? "retry" : "done";
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe("done");
  expect(last?.status, JSON.stringify(last?.body)).toBe(200);
  const id = last?.body.data?.requestId;
  expect(id).toBeTruthy();
  return id as string;
}

interface RequestRead {
  status: string;
  lines: { path: string; outcome?: string; classification: string }[];
  remote: { target: string; outcome?: string }[];
}

async function readRequest(request: APIRequestContext, id: string): Promise<RequestRead> {
  const res = await request.get(`/api/access/provision/${id}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: RequestRead }).data;
}

interface Health {
  pid?: number;
  startedAt?: string;
  accessGrants?: { prompting?: { operatorChannels?: number }; provisioning?: { pending: number; created: number } };
}

async function health(request: APIRequestContext): Promise<Health | null> {
  try {
    const res = await request.get("/api/health", { timeout: 5_000 });
    return res.ok() ? ((await res.json()) as Health) : null;
  } catch {
    return null; // mid-restart
  }
}

/** Creations this file has spent against D6's global budget since the last restart (null = unknown). */
let spent: number | null = null;

/**
 * Restart the dashboard server when the next `need` creations would exceed D6's
 * global budget. The registry is in memory, so a new process starts at zero;
 * pi sessions are separate processes and survive.
 */
async function ensureBudget(request: APIRequestContext, need: number): Promise<void> {
  // `/api/health` omits `accessGrants` for a caller that is neither authenticated nor
  // genuinely local (the posture-disclosure gate), so the server's `created` counter
  // is not readable here. Keep our own tally instead; the first call always restarts,
  // which also makes a re-run within 10 minutes of a previous run start from zero.
  if (spent !== null && spent + need <= GLOBAL_RATE_MAX) {
    spent += need;
    return;
  }
  const before = await health(request);
  expect(before, "health must be readable").not.toBeNull();
  spent = need;
  await request.post("/api/restart", { timeout: 10_000 }).catch(() => {
    // The server tears the socket down mid-response: the expected shape of a restart.
  });
  await expect
    .poll(
      async () => {
        const now = await health(request);
        return now?.pid != null && (now.pid !== before?.pid || now.startedAt !== before?.startedAt);
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
}

// ── operators ────────────────────────────────────────────────────────────────

const dialog = (page: Page) => page.getByTestId("provision-dialog");
const section = (page: Page) => page.getByTestId("access-provision-section");

/**
 * A browser context on the Access page that HOLDS a prompt capability. The page's
 * read-only callout disappears exactly when `useHasGrantChannel()` turns true, so
 * waiting for it proves the server's `grant_channel` frame landed.
 */
async function openOperator(browser: Browser, prepare?: (page: Page) => Promise<void>): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: `http://localhost:${DASHBOARD_PORT}` });
  const page = await ctx.newPage();
  await prepare?.(page);
  await gotoDashboard(page);
  await page.goto("/settings/access");
  await expect(section(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("access-provision-readonly")).toHaveCount(0, { timeout: 20_000 });
  return page;
}

/** See the file header: the modal dialog covers the Access page, so the click goes to the control directly. */
async function pressBehindDialog(control: Locator): Promise<void> {
  await expect(control).toBeEnabled({ timeout: 15_000 });
  await control.dispatchEvent("click");
}

/** Tick the line for `path` in the dialog and answer. Nothing is preselected, so this is explicit. */
async function approveInDialog(page: Page, ...approve: string[]): Promise<void> {
  for (const path of approve) {
    await dialog(page)
      .getByTestId("provision-line")
      .filter({ has: page.getByTestId("provision-line-path").filter({ hasText: path }) })
      .getByTestId("provision-line-approve")
      .check();
  }
  await dialog(page).getByTestId("provision-approve").click();
}

// ── grants ───────────────────────────────────────────────────────────────────

interface GrantRow {
  subject: string;
  scope: string;
  via?: string;
  origin?: string;
}

async function listGrants(request: APIRequestContext): Promise<GrantRow[]> {
  const res = await request.get("/api/access/grants");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: { pathGrants: GrantRow[] } };
  return body.data.pathGrants;
}

/** Revoke (loopback, the real route) every grant this spec could have written. */
function revokeSpecGrants(): void {
  inContainer(`
    const base = "http://127.0.0.1:${DASHBOARD_PORT}";
    (async () => {
      const grants = (await (await fetch(base + "/api/access/grants")).json()).data.pathGrants;
      for (const g of grants) {
        if (g.subject !== ${JSON.stringify(BASE)} && !g.subject.startsWith(${JSON.stringify(`${BASE}/`)})) continue;
        await fetch(base + "/api/access/grants", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: g.subject, scope: g.scope }),
        });
      }
    })();
  `);
}

/** Dismiss whatever is still pending, from a capability-holding page's own `fetch`. */
async function dismissPending(browser: Browser, request: APIRequestContext): Promise<void> {
  if (((await health(request))?.accessGrants?.provisioning?.pending ?? 0) === 0) return;
  const page = await openOperator(browser);
  try {
    await page.evaluate(() => fetch("/api/access/provision/dismiss-all", { method: "POST" }).then((r) => r.status));
    await expect
      .poll(async () => (await health(request))?.accessGrants?.provisioning?.pending ?? 0, { timeout: 10_000 })
      .toBe(0);
  } finally {
    await page.context().close();
  }
}

let savedConfig = "";

test.describe.serial("access provisioning (add-access-provisioning 5g)", () => {
  // Under the kill switch no dialog can exist by design.
  test.skip(process.env.PI_DASHBOARD_DISABLE_GRANT_PROMPT === "1", "prompting force-disabled by the kill switch");

  test.beforeAll(async ({ request }) => {
    savedConfig = inContainer(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(CONFIG)}, "utf8"));`);
    inContainer(`
      const fs = require("node:fs");
      fs.rmSync(${JSON.stringify(BASE)}, { recursive: true, force: true });
      fs.mkdirSync(${JSON.stringify(LINES)}, { recursive: true });
      fs.mkdirSync(${JSON.stringify(ROOTS)}, { recursive: true });
    `);
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
    patchConfig({ accessGrants: { promptEnabled: true } });
  });

  test.afterAll(() => {
    revokeSpecGrants();
    inContainer(`
      const fs = require("node:fs");
      const p = ${JSON.stringify(CONFIG)};
      fs.writeFileSync(p + ".e2e.tmp", ${JSON.stringify(savedConfig)});
      fs.renameSync(p + ".e2e.tmp", p);
      fs.rmSync(${JSON.stringify(BASE)}, { recursive: true, force: true });
    `);
  });

  test.afterEach(async ({ browser, request }) => {
    revokeSpecGrants();
    await dismissPending(browser, request).catch(() => undefined);
  });

  // #F1 — two operators; A answers; B converges without being asked.
  test("5.3 / #F1: first answer wins across two clients; one grant, B's dialog closes via provision_dismiss", async ({
    browser,
    request,
  }) => {
    await ensureBudget(request, 1);
    const lib = seedFolder(`${LINES}/F1-lib`);
    const root = seedRoot("F1");
    const a = await openOperator(browser);
    const b = await openOperator(browser);
    try {
      const id = await proposeWhenOperatorReady(request, { projectRoot: root, lines: [{ path: lib, why: "shared lib" }] });
      await expect(dialog(a)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(b)).toBeVisible({ timeout: 15_000 });
      // Both show the requester's claim and the real path; nothing is preselected.
      await expect(dialog(b).getByTestId("provision-root")).toHaveText(root);
      await expect(dialog(b).getByTestId("provision-line-approve")).not.toBeChecked();

      await approveInDialog(a, lib);
      await expect(dialog(a)).toHaveCount(0);
      await expect(dialog(b)).toHaveCount(0, { timeout: 5_000 });

      const read = await readRequest(request, id);
      expect(read.status).toBe("settled");
      expect(read.lines.map((l) => l.outcome)).toEqual(["granted"]);
      const held = (await listGrants(request)).filter((g) => g.subject === lib);
      expect(held).toHaveLength(1);
      expect(held[0]?.via).toBe("provision");
      expect(held[0]?.origin).toBe(root);
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  // #F2 — tab B answers from Settings ▸ Access while tab A's dialog is open.
  test("5.4 / #F2: answering from the Access page settles the request, closes A's dialog, labels the grant", async ({
    browser,
    request,
  }) => {
    await ensureBudget(request, 1);
    const lib = seedFolder(`${LINES}/F2-lib`);
    const root = seedRoot("F2");
    const a = await openOperator(browser);
    let b: Page | undefined;
    try {
      const id = await proposeWhenOperatorReady(request, { projectRoot: root, lines: [{ path: lib, why: "shared lib" }] });
      await expect(dialog(a)).toBeVisible({ timeout: 15_000 });

      b = await openOperator(browser);
      const card = section(b).locator(`[data-testid="access-provision-request"][data-request-id="${id}"]`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByTestId("access-provision-root")).toHaveText(root);
      // Behind B's own dialog (see the file header); the handlers and the route are the real ones.
      const approve = card
        .getByTestId("provision-line")
        .filter({ has: b.getByTestId("provision-line-path").filter({ hasText: lib }) })
        .getByTestId("provision-line-approve");
      await approve.dispatchEvent("click");
      await expect(approve).toBeChecked();
      await pressBehindDialog(card.getByTestId("access-provision-approve"));

      await expect.poll(async () => (await readRequest(request, id)).status, { timeout: 15_000 }).toBe("settled");
      expect((await readRequest(request, id)).lines.map((l) => l.outcome)).toEqual(["granted"]);
      await expect(dialog(a)).toHaveCount(0, { timeout: 5_000 });

      // The grants list loads on mount only, so B reloads the page to read the store.
      await b.reload();
      const row = b.getByTestId("access-entry").filter({ hasText: lib });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByTestId("access-entry-via-provision")).toBeVisible();
      await expect(row.getByTestId("access-entry-requested-for")).toContainText(root);
      await expect(row.getByTestId("access-revoke")).toBeVisible();
    } finally {
      await a.context().close();
      await b?.context().close();
    }
  });

  // #F5 — a dropped socket reconciles; also the "ended meanwhile" half.
  test("5.6 / #F5: a reconnect re-renders a still-pending request and drops one that ended meanwhile", async ({
    browser,
    request,
  }) => {
    await ensureBudget(request, 1);
    const lib = seedFolder(`${LINES}/F5-lib`);
    const root = seedRoot("F5");
    const routes: WebSocketRoute[] = [];
    const state = { drop: false };
    const a = await openOperator(browser, async (page) => {
      await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
        routes.push(ws);
        const server = ws.connectToServer();
        ws.onMessage((m) => server.send(m));
        server.onMessage((m) => {
          if (!state.drop) ws.send(m);
        });
      });
    });
    const b = await openOperator(browser);
    try {
      await proposeWhenOperatorReady(request, { projectRoot: root, lines: [{ path: lib, why: "shared lib" }] });
      await expect(dialog(a)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(b)).toBeVisible({ timeout: 15_000 });

      // A page reload is the reconnect: it opens a fresh socket and the host re-reads
      // GET /api/access/provision. (Closing the routed socket does not make the client
      // reconnect under this harness; access-grant-dialog.spec.ts #F9 fails the same
      // way there. The WS-close reconnect trigger is covered by ProvisionPromptHost.test.)
      const cut = async () => {
        const n = routes.length;
        await a.reload();
        await expect.poll(() => routes.length, { timeout: 20_000 }).toBeGreaterThan(n);
      };

      // Pending across a reconnect: still rendered for A.
      await cut();
      await expect(dialog(a)).toBeVisible({ timeout: 15_000 });

      // B ends the request while A is not listening: A misses `provision_dismiss`...
      state.drop = true;
      await dialog(b).getByTestId("provision-reject-all").click();
      await expect(dialog(b)).toHaveCount(0);
      await a.waitForTimeout(1000);
      await expect(dialog(a), "the dropped link hid the dismiss").toBeVisible();
      // ...and converges once it reconnects (the reconcile reads GET /api/access/provision).
      state.drop = false;
      await cut();
      await expect(dialog(a)).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await a.context().close();
      await b.context().close();
    }
  });

  // #F4 — three roots pending; one click; every root enters its cooldown.
  test("5.5 / #F4: Dismiss all pending dismisses all 3 and starts a cooldown per root", async ({ browser, request }) => {
    await ensureBudget(request, 3);
    const roots = ["F4-a", "F4-b", "F4-c"].map((n) => seedRoot(n));
    const folders = ["F4-a", "F4-b", "F4-c"].map((n) => seedFolder(`${LINES}/${n}`));
    const a = await openOperator(browser);
    try {
      const ids: string[] = [];
      for (const [i, root] of roots.entries()) {
        ids.push(await proposeWhenOperatorReady(request, { projectRoot: root, lines: [{ path: folders[i], why: "lib" }] }));
      }
      await expect(dialog(a)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(a).getByTestId("provision-queued")).toContainText("2");
      await expect(section(a).getByTestId("access-provision-request")).toHaveCount(3, { timeout: 15_000 });

      await pressBehindDialog(section(a).getByTestId("access-provision-dismiss-all"));

      for (const id of ids) {
        await expect.poll(async () => (await readRequest(request, id)).status, { timeout: 15_000 }).toBe("dismissed");
      }
      await expect(dialog(a)).toHaveCount(0, { timeout: 5_000 });
      await expect(section(a).getByTestId("access-provision-empty")).toBeVisible({ timeout: 15_000 });

      for (const [i, root] of roots.entries()) {
        const again = await propose(request, { projectRoot: root, lines: [{ path: folders[i], why: "lib" }] });
        expect(again.status, root).toBe(429);
        expect(again.body.error, root).toBe("cooldown");
      }
      expect(await listGrants(request).then((g) => g.filter((x) => folders.includes(x.subject)))).toHaveLength(0);
    } finally {
      await a.context().close();
    }
  });

  // #F6 — a remote goal only opens the wizard's landing; it changes no config.
  test("5.7 / #F6: Open Remote access shows the wizard landing and leaves the trust config untouched", async ({
    browser,
    request,
  }) => {
    await ensureBudget(request, 1);
    const root = seedRoot("F6");
    const trust = async () => {
      const res = (await (await request.get("/api/access/grants")).json()) as {
        data: { trustedNetworks: unknown; corsOrigins: unknown };
      };
      return { trustedNetworks: res.data.trustedNetworks, corsOrigins: res.data.corsOrigins };
    };
    const before = await trust();
    const a = await openOperator(browser);
    try {
      await proposeWhenOperatorReady(request, { projectRoot: root, lines: [], remote: ["internet"] });
      await expect(dialog(a)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(a).getByTestId("provision-goal")).toHaveAttribute("data-goal", "internet");

      await dialog(a).getByTestId("provision-open-remote").click();
      await expect(a.getByTestId("remote-access-landing")).toBeVisible({ timeout: 15_000 });
      for (const task of ["share", "device", "lan", "connect"]) {
        await expect(a.getByTestId(`remote-access-task-${task}`)).toBeVisible();
      }
      expect(await trust()).toEqual(before);

      await a.getByTestId("gateway-done").click();
      await expect(a.getByTestId("remote-access-landing")).toHaveCount(0);
      await dialog(a).getByTestId("provision-reject-all").click();
      await expect(dialog(a)).toHaveCount(0);
      expect(await trust()).toEqual(before);
    } finally {
      await a.context().close();
    }
  });

  // #X9 — the only operator browser goes away mid-dialog.
  test("5.8 / #X9: closing the only operator leaves the request pending; a new request gets 409 no-operator", async ({
    browser,
    request,
  }) => {
    await ensureBudget(request, 1);
    const lib = seedFolder(`${LINES}/X9-lib`);
    const root = seedRoot("X9");
    const other = seedRoot("X9-other");
    const first = await openOperator(browser);
    const id = await proposeWhenOperatorReady(request, { projectRoot: root, lines: [{ path: lib, why: "lib" }] });
    await expect(dialog(first)).toBeVisible({ timeout: 15_000 });
    await first.context().close();

    // The gateway releases the capability on socket close. (`/api/health` cannot be polled
    // for `operatorChannels` here: it omits `accessGrants` for a non-local caller.)
    await new Promise((r) => setTimeout(r, 3000));

    const refused = await propose(request, { projectRoot: other, lines: [{ path: lib, why: "lib" }] });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("no-operator");

    // Still pending after the operator left; nothing settled, nothing granted.
    await new Promise((r) => setTimeout(r, 3000));
    expect((await readRequest(request, id)).status).toBe("pending");
    expect((await listGrants(request)).filter((g) => g.subject === lib)).toHaveLength(0);

    // A browser that connects later is shown that same request (reconcile from the server's list).
    const second = await openOperator(browser);
    try {
      await expect(dialog(second)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(second).getByTestId("provision-root")).toHaveText(root);
      await dialog(second).getByTestId("provision-reject-all").click();
      await expect(dialog(second)).toHaveCount(0);
    } finally {
      await second.context().close();
    }
  });

  // #X11 — the profile file is only a prompt for the skill; it grants nothing.
  test("5.9 / #X11: a .pi/access.json profile alone grants nothing; the session's read is gated", async ({ page }) => {
    const root = seedRoot("X11");
    seedFolder(LIB);
    seedFolder(OTHER);
    // The D12 profile the skill would read. The server never reads it.
    inContainer(`
      const fs = require("node:fs");
      fs.mkdirSync(${JSON.stringify(`${root}/.pi`)}, { recursive: true });
      fs.writeFileSync(${JSON.stringify(`${root}/.pi/access.json`)}, JSON.stringify({
        version: 1,
        folders: [{ path: ${JSON.stringify(LIB)}, why: "sibling lib" }],
      }));
    `);
    expect((await listGrants(page.request)).filter((g) => g.subject === LIB)).toHaveLength(0);

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:tool-read-provisioned]] go");
    // The first scripted read is `lib`: the gate card's `Path:` code span names exactly that file.
    // (Exact match on the span: the card title renders `__prov-e2e__` as bold markdown.)
    await expect(page.getByText(`${LIB}/x.txt`, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /^Allow once/i }).first()).toBeVisible();
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    expect((await listGrants(page.request)).filter((g) => g.subject === LIB)).toHaveLength(0);
    await page.getByRole("button", { name: /^Deny/i }).first().click();
  });

  // #X12 — propose over HTTP exactly as the skill does; answer in the dialog; read for real.
  test("5.10 / #X12: approved folder reads silently, rejected one still prompts, Access page labels the grant", async ({
    page,
    request,
  }) => {
    await ensureBudget(request, 1);
    const root = seedRoot("X12");
    seedFolder(LIB);
    seedFolder(OTHER);
    // The skill's request shape: the profile's `folders` verbatim, plus the project root.
    inContainer(`
      const fs = require("node:fs");
      fs.mkdirSync(${JSON.stringify(`${root}/.pi`)}, { recursive: true });
      fs.writeFileSync(${JSON.stringify(`${root}/.pi/access.json`)}, JSON.stringify({
        version: 1,
        folders: [
          { path: ${JSON.stringify(LIB)}, why: "sibling lib used by tests" },
          { path: ${JSON.stringify(OTHER)}, why: "unrelated folder" },
        ],
      }));
    `);
    const profile = JSON.parse(
      inContainer(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(`${root}/.pi/access.json`)}, "utf8"));`),
    ) as { version: number; folders: { path: string; why: string }[] };
    expect(profile.version).toBe(1);

    const card = await spawnFreshGitSession(page);
    await card.click();

    const id = await proposeWhenOperatorReady(request, { projectRoot: root, lines: profile.folders });
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page).getByTestId("provision-line")).toHaveCount(2);
    await approveInDialog(page, LIB); // `other` is left unticked = rejected
    await expect(dialog(page)).toHaveCount(0);

    await expect.poll(async () => (await readRequest(request, id)).status, { timeout: 15_000 }).toBe("settled");
    const byPath = Object.fromEntries((await readRequest(request, id)).lines.map((l) => [l.path, l.outcome]));
    expect(byPath[LIB]).toBe("granted");
    expect(byPath[OTHER]).toBe("rejected");

    // The real session: `lib` is read without a prompt, `other` still raises the gate.
    await sendPrompt(page, "[[faux:tool-read-provisioned]] go");
    await expect(page.getByText(`${OTHER}/x.txt`, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(`Read ${LIB}/x.txt`).first()).toBeVisible({ timeout: 30_000 });
    // Exactly one gate card ever rendered, and it is not for `lib`.
    await expect(page.getByText(/outside its workspace/)).toHaveCount(1);
    await expect(page.getByText(`${LIB}/x.txt`, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Deny/i }).first().click();
    await expect(page.getByText("provisioned reads done")).toBeVisible({ timeout: 30_000 });

    await page.goto("/settings/access");
    const row = page.getByTestId("access-entry").filter({ hasText: LIB });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("access-entry-via-provision")).toBeVisible();
    await expect(row.getByTestId("access-entry-requested-for")).toContainText(root);
    await expect(page.getByTestId("access-entry").filter({ hasText: OTHER })).toHaveCount(0);
  });
});
