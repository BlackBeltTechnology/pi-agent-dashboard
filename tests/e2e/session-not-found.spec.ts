/**
 * L3 — unresolved `/session/:id` URLs: inline not-found, server lookup for ids
 * outside the windowed snapshot, and the reconnect / archive edge cases.
 *
 * Covers test-plan #F14, #F15, #F16, #F18, #F19 of change
 * `add-session-ui-deep-links-for-agents` (spec url-routing).
 *
 * Exemplars: `archive-fold.spec.ts` (archive from the sidebar card),
 * `sessions-page-stub-group.spec.ts` (the seeded ended session OUTSIDE the
 * snapshot window: `STUB_SESSION_ID`, scripts/seed-sessions-window.mjs) and
 * `paging-exhausted-reconnect-rearm.spec.ts` (hard WebSocket cut).
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { expect, type Page, test } from "./fixtures.js";
import { ensureGitSession, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

const DESKTOP = { width: 1280, height: 800 } as const;
/** Every seeded session carries this name prefix (cleanup selector) and lives in one group. */
const SEED_PREFIX = "e2e-deeplink";
const SEED_CWD = "/fixtures/e2e-deeplink";
const SEED_DIR = "--fixtures-e2e-deeplink--";
/** More than SNAPSHOT_ENDED_GLOBAL (120) so the oldest falls outside the snapshot window. */
const SEED_COUNT = 130;

function harnessContainer(): string {
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error("no running harness container");
  return id;
}

/** Run a node snippet inside the container (base64-staged: no quoting hazards). */
function runNode(script: string): string {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return execFileSync(
    "docker",
    ["exec", harnessContainer(), "sh", "-c", `node -e 'eval(Buffer.from("${b64}","base64").toString("utf8"))'`],
    { encoding: "utf8", timeout: 120_000 },
  ).trim();
}

function cleanupSeeded(): void {
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `fs.rmSync(p.join(process.env.HOME,".pi/agent/sessions",${JSON.stringify(SEED_DIR)}),{recursive:true,force:true});`,
  );
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 2_000));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

/** Seed SEED_COUNT ended sessions (oldest first by index) and return the OLDEST id. */
function seedEndedSessions(): string {
  const ids = Array.from({ length: SEED_COUNT }, () => crypto.randomUUID());
  const now = Date.now();
  const rows = ids.map((id, i) => {
    // i = 0 is the OLDEST; all within the last day so nothing is age-archived at boot.
    const startedAt = now - (SEED_COUNT - i + 60) * 60_000;
    return { id, name: `${SEED_PREFIX}-${i}`, startedAt, endedAt: startedAt + 30_000 };
  });
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const root=p.join(process.env.HOME,".pi/agent/sessions",${JSON.stringify(SEED_DIR)});fs.mkdirSync(root,{recursive:true});` +
      `for(const r of ${JSON.stringify(rows)}){` +
      `const stamp=new Date(r.startedAt).toISOString().replace(/:/g,"-").replace(/\\./g,"-");` +
      `fs.writeFileSync(p.join(root,stamp+"_"+r.id+".jsonl"),JSON.stringify({type:"session",id:r.id,cwd:${JSON.stringify(SEED_CWD)}})+"\\n");` +
      `fs.writeFileSync(p.join(root,stamp+"_"+r.id+".meta.json"),JSON.stringify({cwd:${JSON.stringify(SEED_CWD)},status:"ended",startedAt:r.startedAt,endedAt:r.endedAt,name:r.name})+"\\n");}`,
  );
  return ids[0] as string;
}

async function liveSessionId(page: Page): Promise<string> {
  const card = await ensureGitSession(page);
  const id = await card.getAttribute("data-session-id");
  expect(id).toBeTruthy();
  return id as string;
}

test.describe("session deep link: not found and lookup (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
  });

  test("F14: an unknown id shows the not-found state once the snapshot is applied, and stays", async ({ page }) => {
    await liveSessionId(page);
    await page.goto("/session/does-not-exist");
    // The snapshot is applied once the sidebar lists a session.
    await expect(page.getByTestId("session-card-desktop").first()).toBeVisible({ timeout: 30_000 });
    const nf = page.getByTestId("session-not-found");
    await expect(nf).toBeVisible({ timeout: 30_000 });
    await expect(nf).toContainText("does-not-exist");
    await expect
      .poll(() => page.url(), { timeout: 2_000, intervals: [250] })
      .toMatch(/\/session\/does-not-exist$/);
    await expect(nf).toBeVisible();
  });

  test("F15: an ended session outside the snapshot window opens through the id lookup", async ({ page }) => {
    test.setTimeout(240_000);
    cleanupSeeded();
    const oldestId = seedEndedSessions();
    try {
      await restartDashboard();
      const lookups: string[] = [];
      page.on("request", (req) => {
        const u = req.url();
        if (u.includes("/api/sessions?") && u.includes("id=")) lookups.push(u);
      });
      await page.goto(`/session/${oldestId}`);
      await expect(page.getByTestId("session-header")).toContainText(`${SEED_PREFIX}-0`, { timeout: 60_000 });
      await expect(page.getByTestId("session-not-found")).toHaveCount(0);
      expect(lookups.filter((u) => u.includes(oldestId))).toHaveLength(1);
    } finally {
      cleanupSeeded();
      await restartDashboard();
    }
  });

  test("F16: an unknown id on the desktop diff route shows not-found and never fetches a diff", async ({ page }) => {
    const diffRequests: string[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("session-diff") && u.includes("does-not-exist")) diffRequests.push(u);
    });
    await liveSessionId(page);
    await page.goto("/session/does-not-exist/diff");
    await expect(page.getByTestId("session-not-found")).toBeVisible({ timeout: 30_000 });
    expect(diffRequests).toEqual([]);
  });

  test("F18: a WebSocket reconnect never blanks the open session", async ({ page }) => {
    const id = await liveSessionId(page);
    // Track live sockets (before any page script runs) so the ESTABLISHED one
    // can be closed: `setOffline(true)` does not close an open WebSocket. The app
    // then reconnects itself — same React instance, so the sticky id is exercised.
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
    let snapshots = 0;
    page.on("websocket", (ws) =>
      ws.on("framereceived", (f) => {
        if (String(f.payload).includes("sessions_snapshot")) snapshots++;
      }),
    );
    await page.goto(`/session/${id}`);
    const composer = page.getByPlaceholder(/message/i).first();
    await expect(composer).toBeVisible({ timeout: 30_000 });
    const handle = await composer.elementHandle();
    await expect.poll(() => snapshots, { timeout: 30_000 }).toBeGreaterThan(0);
    const before = snapshots;

    await page.evaluate(() => {
      for (const s of (window as unknown as { __dashSockets: WebSocket[] }).__dashSockets) {
        try {
          s.close();
        } catch {
          /* already gone */
        }
      }
    });

    // Poll across the whole reconnect window, until the NEW snapshot has landed.
    const seen = { notFound: 0, resolving: 0 };
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      seen.notFound += await page.getByTestId("session-not-found").count();
      seen.resolving += await page.getByTestId("session-resolving").count();
      if (snapshots > before) break;
      await page.waitForTimeout(100);
    }
    expect(snapshots, "the reconnect delivered a fresh snapshot").toBeGreaterThan(before);
    for (let i = 0; i < 10; i++) {
      seen.notFound += await page.getByTestId("session-not-found").count();
      seen.resolving += await page.getByTestId("session-resolving").count();
      await page.waitForTimeout(100);
    }
    expect(seen).toEqual({ notFound: 0, resolving: 0 });
    expect(await handle?.evaluate((el) => el.isConnected)).toBe(true);
  });

  test("F19: archiving the viewed session converges to / without a not-found flash", async ({ page }) => {
    const card = await spawnFreshGitSession(page);
    const id = (await card.getAttribute("data-session-id")) as string;
    await page.goto(`/session/${id}`);
    await expect(page.getByPlaceholder(/message/i).first()).toBeVisible({ timeout: 30_000 });

    let flashes = 0;
    const timer = setInterval(() => {
      void page
        .getByTestId("session-not-found")
        .count()
        .then((n) => {
          flashes = Math.max(flashes, n);
        })
        .catch(() => undefined);
    }, 100);
    try {
      await page.locator(`[data-session-id="${id}"]`).getByTestId("session-archive-btn").first().click();
      // An idle-alive session confirms first (archiving ends its pi process).
      const confirm = page.getByTestId("session-archive-confirm");
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.getByRole("button", { name: /archive session/i }).click();
      }
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe("/");
    } finally {
      clearInterval(timer);
    }
    expect(flashes).toBe(0);
    await expect(page.getByTestId("session-not-found")).toHaveCount(0);
  });
});
