/**
 * Browser E2E — live agent control of an open Craft editor (change: add-craft-live-control).
 *
 * The `craft_control` tool is driven through its real server router: the harness runs with
 * `PI_DASHBOARD_FIXTURE_PLUGINS=1`, which mounts the FakeCraft test double and a test-only driver route,
 * `POST /api/plugins/craft-web/fixture/control` (body = the tool's arguments plus `sessionId`). The route
 * calls the same router a pi session's `craft_control` reaches over the request lane, so probe → claim →
 * run → result, path matching, TTLs and the host policy are the shipped ones; only the pi bridge hop and the
 * model are missing (the bridge tool is covered at L1).
 *
 * Rows tagged "VectorCraft" run against the REAL pinned VectorCraft web build (the harness needs network,
 * as `craft-web-editor.spec.ts` does); all others use FakeCraft.
 *
 * Test-plan ids in the titles: #E22–E25, #P1, #P2, #F1, #F3–#F6, #X7–#X13, #X16.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Frame, Locator, Page } from "@playwright/test";
import { CRAFT_APP_PROFILES } from "../../packages/craft-web-plugin/src/shared/app-profiles.js";
import { expect, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

const DESKTOP = { width: 1440, height: 900 } as const;
const API = `http://localhost:${DASHBOARD_PORT}`;
const ABS = (rel: string) => `${FIXTURE_GIT}/${rel}`;
const FIXTURE_DIR = path.join(REPO_ROOT, "docker", "fixtures", "sample-git");
const DOC = "doc.fakecraft";
const DOC_BYTES = Buffer.from('{"text":"","ops":0,"revision":0}');
const SVG = "shapes.svg";
const SVG_BYTES = fs.readFileSync(path.join(FIXTURE_DIR, "craft", SVG));
const DOCX = "report.docx";
const OPEN_TIMEOUT = 90_000;

/**
 * One row per app with a `control` profile (task 8.3 / 8.20 are parametrized over them): the workspace
 * file, its edit claim and the gate-recorded creating command. A control app without a row fails
 * the guard test below, so enabling an app (task 10.x) cannot skip its live rows.
 */
interface ControlRow {
  appId: string;
  file: string;
  bytes: Buffer;
  claimId: string;
  create: { command: string; params: Record<string, unknown> };
  /** Reads the created object's id out of the create reply. */
  createdId: (result: any) => number;
}
const CONTROL_ROWS: readonly ControlRow[] = [
  { appId: "vectorcraft", file: SVG, bytes: SVG_BYTES, claimId: "vectorcraft", create: { command: "shape.rectangle", params: { x: 5, y: 5, width: 40, height: 30 } }, createdId: (r) => r.id },
];

// ---------------------------------------------------------------- container I/O (as craft-web-editor.spec.ts)

function inBox(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
function writeBytesOob(rel: string, bytes: Uint8Array): void {
  const q = JSON.stringify(ABS(rel));
  execFileSync("docker", ["exec", "-i", resolveContainer(), "sh", "-c", `base64 -d > ${q} && chmod 666 ${q}`], {
    input: Buffer.from(bytes).toString("base64"),
    maxBuffer: 64 * 1024 * 1024,
  });
}
const existsOob = (rel: string): boolean => inBox(`[ -e ${JSON.stringify(ABS(rel))} ] && echo y || echo n`) === "y";
const shaOob = (rel: string): string => inBox(`sha1sum ${JSON.stringify(ABS(rel))} | cut -d' ' -f1`);

// ---------------------------------------------------------------- dashboard plumbing

async function pluginEnabled(): Promise<boolean> {
  const body = (await (await fetch(`${API}/api/plugins`)).json()) as { plugins?: Array<{ id: string; status?: { enabled?: boolean } | null }> };
  return body.plugins?.find((r) => r.id === "craft-web")?.status?.enabled === true;
}
async function status(): Promise<{ http: number; apps?: Record<string, { status: string; reason?: string }> }> {
  const res = await fetch(`${API}/api/plugins/craft-web/status`);
  if (!res.ok) return { http: res.status };
  return { http: res.status, apps: ((await res.json()) as { apps: Record<string, { status: string }> }).apps };
}
async function togglePlugin(enabled: boolean): Promise<void> {
  const res = await fetch(`${API}/api/plugins/craft-web/toggle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
  expect(res.ok, `toggle craft-web → ${enabled}: HTTP ${res.status}`).toBeTruthy();
}
async function restartDashboard(): Promise<void> {
  await fetch(`${API}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) return;
    } catch {
      /* still down */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}
async function prepare(app: string): Promise<void> {
  const res = await fetch(`${API}/api/plugins/craft-web/prepare/${app}`, { method: "POST" });
  expect(res.ok, `prepare ${app}: HTTP ${res.status}`).toBeTruthy();
}

interface ControlReply {
  ok: boolean;
  code?: string;
  message?: string;
  instance?: string;
  app?: string;
  result?: any;
  saveRequested?: boolean;
  saveSeq?: number;
}
type ControlArgs = { path?: string; method: string; params?: unknown; instance?: string };

/** The router admits 20 routed requests per 10 s per session (host.state is exempt): stay under it client-side. */
const sentAt = new Map<string, number[]>();
async function throttle(sessionId: string): Promise<void> {
  for (;;) {
    const now = Date.now();
    const recent = (sentAt.get(sessionId) ?? []).filter((t) => now - t < 10_200);
    if (recent.length < 18) {
      recent.push(now);
      sentAt.set(sessionId, recent);
      return;
    }
    sentAt.set(sessionId, recent);
    await new Promise((r) => setTimeout(r, recent[0] + 10_200 - now));
  }
}

/** One `craft_control` call through the real router (see file header), paced under the rate limit. */
async function control(sessionId: string, args: ControlArgs): Promise<ControlReply> {
  if (args.method !== "host.state") await throttle(sessionId);
  return controlNow(sessionId, args);
}

async function controlNow(sessionId: string, args: ControlArgs): Promise<ControlReply> {
  const res = await fetch(`${API}/api/plugins/craft-web/fixture/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, ...args }),
  });
  expect(res.ok, `fixture/control: HTTP ${res.status}`).toBeTruthy();
  return (await res.json()) as ControlReply;
}
const exec = (sid: string, path: string, command: string, params?: unknown, instance?: string) =>
  control(sid, { ...(instance ? { instance } : { path }), method: "engine.execute", params: params === undefined ? { command } : { command, params } });

let initiallyEnabled = false;
test.beforeAll(async () => {
  test.setTimeout(900_000);
  initiallyEnabled = await pluginEnabled();
  const st = await status();
  if (st.http === 404 || st.apps?.vectorcraft?.reason === "restart-required" || st.apps?.vectorcraft?.reason === "disabled" || !st.apps?.fakecraft) {
    if (!initiallyEnabled) await togglePlugin(true);
    await restartDashboard();
  }
  const after = await status();
  expect(after.apps?.fakecraft?.status, "FakeCraft needs the harness to run with PI_DASHBOARD_FIXTURE_PLUGINS=1").toBe("ok");
  await prepare("vectorcraft");
  await prepare("wordcraft");
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  if (!initiallyEnabled) {
    await togglePlugin(false);
    await restartDashboard();
  }
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  writeBytesOob(DOC, DOC_BYTES);
  writeBytesOob(SVG, SVG_BYTES);
  writeBytesOob(DOCX, fs.readFileSync(path.join(FIXTURE_DIR, DOCX)));
});
test.afterEach(() => {
  inBox(`rm -f ${["shapes.vectorcraft", "export.pdf"].map((f) => JSON.stringify(ABS(f))).join(" ")}`);
});

// ---------------------------------------------------------------- editor plumbing

async function sessionIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("data-session-id");
  if (!id) throw new Error("session card has no data-session-id");
  return id;
}
async function openInPane(page: Page, sid: string, rel: string): Promise<void> {
  await page.goto(`/session/${sid}/editor?file=${encodeURIComponent(rel)}`);
  const pane = page.getByTestId("split-editor-pane").first();
  // The deep link selects the file but, on a fresh browser context, can leave the view on Chat: open the pane.
  if (!(await pane.isVisible({ timeout: 6_000 }).catch(() => false))) await page.getByRole("button", { name: "Editor" }).first().click();
  await expect(pane).toBeVisible({ timeout: 20_000 });
  // Likewise the `?file=` target may not open a tab on its own: pick it from the file tree.
  const tab = page.getByTestId("editor-tab").filter({ hasText: rel }).first();
  if (!(await tab.isVisible({ timeout: 6_000 }).catch(() => false))) {
    const toggle = page.getByTestId("tree-toggle");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await page.getByText(rel, { exact: true }).first().click();
  }
  await expect(tab).toBeVisible({ timeout: 20_000 });
  // Hide the tree again so the editor frame gets the whole pane (a squeezed frame zooms the document to nothing).
  const tree = page.getByTestId("tree-toggle");
  if ((await tree.getAttribute("aria-pressed").catch(() => null)) === "true") await tree.click();
}
async function editIn(page: Page, claimId: string): Promise<{ iframe: Locator; frame: Frame }> {
  await page.getByTestId(`file-mode-craft-web/${claimId}`).click();
  await expect(page.getByTestId("craft-frame-host")).toHaveAttribute("data-phase", "open", { timeout: OPEN_TIMEOUT });
  const iframe = page.getByTestId("craft-frame");
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("craft-frame has no content frame");
  return { iframe, frame };
}
/** A fresh session with `rel` open in `claimId`'s editor. */
async function freshEditor(page: Page, rel: string, claimId: string) {
  const card = await spawnFreshGitSession(page);
  const sid = await sessionIdOf(card);
  await openInPane(page, sid, rel);
  return { sid, ...(await editIn(page, claimId)) };
}
const fakeEditor = (page: Page) => freshEditor(page, DOC, "fakecraft");
const vectorEditor = (page: Page) => freshEditor(page, SVG, "vectorcraft");

/** `window.<global>.request` from INSIDE the frame: what a real user's page would see (read-only probes). */
const inFrame = <T,>(frame: Frame, global: string, method: string, params?: unknown): Promise<T> =>
  frame.evaluate(([g, m, p]) => (window as any)[g as string].request(m as string, p), [global, method, params] as const) as Promise<T>;
const digestOf = async (frame: Frame): Promise<string> => (await inFrame<{ digest: string }>(frame, "fakecraft", "document.inspect")).digest;

/** Count `control` messages the frame receives from now on (frame message log). */
async function logControlMessages(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const w = window as any;
    w.__controlMessages = 0;
    window.addEventListener("message", (e) => {
      if (e.data && e.data.type === "control") w.__controlMessages += 1;
    });
  });
}
const controlMessages = (frame: Frame): Promise<number> => frame.evaluate(() => (window as any).__controlMessages as number);

const guardDialog = (page: Page) => page.getByTestId("file-handler-guard-dialog");
async function closeActiveTab(page: Page, rel: string): Promise<void> {
  await page.getByTestId("editor-tab").filter({ hasText: rel }).click({ button: "middle" });
}

// ---------------------------------------------------------------- the tests

test.describe("live control through the real router", () => {
  test.describe.configure({ timeout: 240_000 });

  test("E22 (8.1, 8.2): a smoke call answers ok; with the file visible on two devices only the last-used one changes", async ({ page, browser }) => {
    const { sid, frame } = await fakeEditor(page);
    const smoke = await exec(sid, DOC, "echo", { smoke: 1 });
    expect(smoke).toMatchObject({ ok: true, app: "fakecraft", result: { smoke: 1 } });
    expect(typeof smoke.instance).toBe("string");

    // A second device (own browser context) shows the same file in the same session; it is opened LAST.
    const second = await browser.newContext({ viewport: DESKTOP });
    const pageB = await second.newPage();
    await openInPane(pageB, sid, DOC);
    const { frame: frameB } = await editIn(pageB, "fakecraft");
    await pageB.bringToFront();
    await pageB.mouse.click(300, 300);
    await page.waitForTimeout(1_000);

    const beforeA = await digestOf(frame);
    const beforeB = await digestOf(frameB);
    const r = await exec(sid, DOC, "echo", { who: "agent" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await digestOf(frameB)).not.toBe(beforeB); // the most recently used device took the request
    expect(await digestOf(frame)).toBe(beforeA); // the other copy is untouched
    await second.close();
  });

  test("E24 (8.4): a file no editor shows → not-open, and the file is untouched", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    const before = shaOob(DOCX);
    const r = await control(sid, { path: DOCX, method: "engine.execute", params: { command: "echo" } });
    expect(r).toMatchObject({ ok: false, code: "not-open" });
    expect(r.message).toMatch(/full operating rights/);
    expect(shaOob(DOCX)).toBe(before);
  });

  test("E25 (8.5): an app without control (WordCraft) → unsupported, and no control message reaches its frame", async ({ page }) => {
    const { sid, frame } = await freshEditor(page, DOCX, "wordcraft");
    await logControlMessages(frame);
    const r = await control(sid, { path: DOCX, method: "document.inspect" });
    expect(r).toMatchObject({ ok: false, code: "unsupported" });
    expect(await controlMessages(frame)).toBe(0);
  });

  test("P1/P2 (8.6, 8.7): 50 routed echo requests p95 ≤ 600 ms; 50 pinned ones p95 ≤ 150 ms", async ({ page }) => {
    test.setTimeout(420_000);
    const { sid } = await fakeEditor(page);
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];
    // Only the router round trip is timed; the client-side pacing under the 20 / 10 s limit is not.
    const timed = async (args: ControlArgs) => {
      await throttle(sid);
      const t0 = performance.now();
      const r = await controlNow(sid, args);
      const ms = performance.now() - t0;
      expect(r.ok, JSON.stringify(r)).toBe(true);
      return { ms, instance: r.instance as string };
    };
    const routed: number[] = [];
    let instance = "";
    for (let i = 0; i < 50; i++) {
      const t = await timed({ path: DOC, method: "engine.execute", params: { command: "ping" } });
      routed.push(t.ms);
      instance = t.instance;
    }
    const pinned: number[] = [];
    for (let i = 0; i < 50; i++) pinned.push((await timed({ instance, method: "engine.execute", params: { command: "ping" } })).ms);
    test.info().annotations.push({ type: "p95", description: `routed ${p95(routed).toFixed(0)} ms, pinned ${p95(pinned).toFixed(0)} ms` });
    expect(p95(routed)).toBeLessThanOrEqual(600);
    expect(p95(pinned)).toBeLessThanOrEqual(150);
  });

  test("F1 (8.8): the agent chip shows the method while a request runs, then goes; the log has one row", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    const running = exec(sid, DOC, "sleep", { ms: 1500 });
    await expect(page.getByTestId("craft-agent-active")).toContainText("engine.execute", { timeout: 5_000 });
    expect((await running).ok).toBe(true);
    await expect(page.getByTestId("craft-agent-active")).toHaveCount(0);
    const log = page.getByTestId("craft-agent-log");
    await log.locator("summary").click();
    const rows = log.getByTestId("craft-agent-log-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("engine.execute");
    await expect(rows.first()).toContainText("ok");
    await expect(rows.first().getByTestId("craft-agent-log-time")).toHaveText(/\d/);
    await expect(rows.first()).toContainText(/\d+ B/);
    expect(((await rows.first().textContent()) ?? "").length).toBeLessThan(250);
  });

  test("F4 (8.10): the user keeps typing while a request runs; the text survives and the result is ok", async ({ page }) => {
    const { sid, frame } = await fakeEditor(page);
    const running = exec(sid, DOC, "sleep", { ms: 3000 });
    await frame.locator("#note").click();
    await page.keyboard.type("typed while busy", { delay: 25 });
    expect((await running).ok).toBe(true);
    await expect(frame.locator("#note")).toHaveValue("typed while busy");
  });

  test("F5 (8.11): the user switches the pane tab between probe and run → not-visible, the frame gets no control message", async ({ page }) => {
    const { sid, frame } = await fakeEditor(page);
    await logControlMessages(frame);
    // a second tab in the pane to switch to (picked from the file tree)
    const toggle = page.getByTestId("tree-toggle");
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await page.getByText("hello.txt", { exact: true }).first().click();
    await expect(page.getByTestId("editor-tab").filter({ hasText: "hello.txt" }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("editor-tab").filter({ hasText: DOC }).first().click();
    await expect(page.getByTestId("craft-frame-host")).toHaveAttribute("data-phase", "open", { timeout: OPEN_TIMEOUT });
    const pending = exec(sid, DOC, "echo", { x: 1 });
    await page.waitForTimeout(60);
    await page.getByTestId("editor-tab").filter({ hasText: "hello.txt" }).first().click();
    expect(await pending).toMatchObject({ ok: false, code: "not-visible" });
    // (the claim may even have been answered not-visible; either way the frame never saw the request)
    expect(await controlMessages(frame)).toBe(0);
  });

  test("F6 (8.12): after an agent edit the clean tab is unsaved, so closing it asks to discard", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    expect((await exec(sid, DOC, "echo", { edit: 1 })).ok).toBe(true);
    await closeActiveTab(page, DOC);
    await expect(guardDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("file-handler-guard-dialog-cancel").click();
  });

  test("X7 (8.13): a request longer than 10 s → timeout 'may still have been applied'; the tab is unsaved", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    const r = await exec(sid, DOC, "sleep", { ms: 12_000 });
    expect(r).toMatchObject({ ok: false, code: "timeout" });
    expect(r.message).toMatch(/may still (have been|be) applied/);
    await closeActiveTab(page, DOC);
    await expect(guardDialog(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("file-handler-guard-dialog-cancel").click();
  });

  test("X8 (8.14): an agent export with no user input for > 2 s asks first: Block → no download, Allow → one", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    await page.waitForTimeout(2_500);
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    expect((await exec(sid, DOC, "export")).ok).toBe(true);
    const dialog = page.getByTestId("craft-download-confirm");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText("export.pdf");
    await page.getByTestId("craft-download-block").click();
    await page.waitForTimeout(1_500);
    expect(downloads).toEqual([]);

    expect((await exec(sid, DOC, "export")).ok).toBe(true);
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const dl = page.waitForEvent("download", { timeout: 15_000 });
    await page.getByTestId("craft-download-allow").click();
    expect((await dl).suggestedFilename()).toBe("export.pdf");
  });

  test("X9 (8.15): the user's own export click downloads at once, no confirmation", async ({ page }) => {
    const { frame } = await fakeEditor(page);
    await page.waitForTimeout(2_500);
    const dl = page.waitForEvent("download", { timeout: 15_000 });
    await frame.locator("#export").click();
    expect((await dl).suggestedFilename()).toBe("export.pdf");
    await expect(page.getByTestId("craft-download-confirm")).toHaveCount(0);
  });

  test("X10 (8.16): an agent save over an externally rewritten file shows the conflict dialog; the external bytes stay; host.state lists conflict", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    const first = await exec(sid, DOC, "echo", { edit: 1 });
    expect(first.ok).toBe(true);
    writeBytesOob(DOC, Buffer.from("external rewrite"));
    const saved = await exec(sid, DOC, "save", undefined, first.instance);
    expect(saved).toMatchObject({ ok: true, saveRequested: true });
    const dlg = page.getByTestId("file-handler-conflict-dialog");
    await expect(dlg).toBeVisible({ timeout: 20_000 });
    expect(inBox(`cat ${JSON.stringify(ABS(DOC))}`)).toBe("external rewrite");
    const state = await control(sid, { instance: first.instance, method: "host.state", params: { sinceSeq: saved.saveSeq } });
    expect(state.result.saves).toMatchObject([{ pending: true }]);
    await page.getByTestId("file-handler-conflict-dialog-copy").click();
    await expect.poll(async () => (await control(sid, { instance: first.instance, method: "host.state", params: { sinceSeq: saved.saveSeq } })).result.saves[0]?.outcome, { timeout: 15_000 }).toBe("copy");
    expect(inBox(`cat ${JSON.stringify(ABS(DOC))}`)).toBe("external rewrite");
  });

  test("X12 (8.18): an in-app Save As the user cancels → host.state: noSaveYet, no records", async ({ page }) => {
    const { sid, frame } = await fakeEditor(page);
    const r = await exec(sid, DOC, "saveDialog");
    expect(r).toMatchObject({ ok: true, saveRequested: true });
    await frame.locator("#dialog-cancel").click();
    const state = await control(sid, { instance: r.instance, method: "host.state", params: { sinceSeq: r.saveSeq } });
    expect(state.result).toMatchObject({ noSaveYet: true, saves: [] });
  });

  test("X13 (8.19): with control enabled the frame still cannot reach the network or the dashboard API (CSP)", async ({ page }) => {
    const { frame } = await fakeEditor(page);
    const refused = await frame.evaluate(async () => {
      const tries = ["https://example.com/", "/api/health", "http://localhost:18000/api/health"];
      return Promise.all(tries.map((u) => fetch(u).then(() => "reached", () => "refused")));
    });
    expect(refused).toEqual(["refused", "refused", "refused"]);
  });

  test("E19-style tool surface: engine.commands lists only the allowlist; an off-list command is denied", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    const list = await control(sid, { path: DOC, method: "engine.commands" });
    expect(list.result.map((c: { id: string }) => c.id).sort()).toEqual(["echo", "export", "malformed", "oversize", "ping", "save", "saveDialog", "setText", "sleep"]);
    expect(await exec(sid, DOC, "file.open")).toMatchObject({ ok: false, code: "denied" });
    expect(await exec(sid, DOC, "oversize", { bytes: 300 * 1024 })).toMatchObject({ ok: false, code: "reply_too_large" });
    expect(await exec(sid, DOC, "malformed")).toMatchObject({ ok: false, code: "app_error" });
  });

  test("a screenshot comes back as a JPEG within the reply cap", async ({ page }) => {
    const { sid } = await fakeEditor(page);
    const r = await control(sid, { path: DOC, method: "ui.screenshot" });
    expect(r).toMatchObject({ ok: true, result: { mime: "image/jpeg" } });
    expect(Buffer.from(r.result.jpegBase64, "base64").subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });
});

test.describe("live control on the real VectorCraft build", () => {
  test.describe.configure({ timeout: 360_000 });

  /** Click until the app reports a selection (a real user click). */
  async function selectByClick(page: Page, iframe: Locator, sid: string, file: string): Promise<number[]> {
    const ui = await control(sid, { path: file, method: "ui.inspect" });
    const [cx, cy, cw, ch] = ui.result.canvasRect as [number, number, number, number];
    const box = (await iframe.boundingBox()) as { x: number; y: number };
    for (let gy = 0.2; gy < 0.9; gy += 0.1) {
      for (let gx = 0.2; gx < 0.9; gx += 0.1) {
        await page.mouse.click(box.x + cx + cw * gx, box.y + cy + ch * gy);
        await page.waitForTimeout(150);
        const sel = (await control(sid, { path: file, method: "document.inspect" })).result.selection as number[];
        if (sel.length > 0) return sel;
      }
    }
    return [];
  }

  for (const row of CONTROL_ROWS) {
    test(`E23 (8.3) ${row.appId}: an agent creates an object in the open file; a non-creating edit keeps the user's selection; no reload`, async ({ page }) => {
      const { sid, iframe } = await freshEditor(page, row.file, row.claimId);
      // A real click needs a real canvas: give the editor the whole width (the split layout leaves ~80 px of canvas).
      const handle = page.getByTestId("split-divider");
      const hb = await handle.boundingBox();
      if (hb) {
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x - 380, hb.y + hb.height / 2, { steps: 12 });
        await page.mouse.up();
      }
      await expect(page.getByTestId("craft-frame-host")).toHaveAttribute("data-phase", "open");
      await page.waitForTimeout(1_000);
      // The zoom was fitted for the narrow canvas: refit (Fit Artboard in Window, Cmd/Ctrl+0) now that it is wide.
      await iframe.click({ position: { x: 200, y: 400 } });
      await page.keyboard.press("ControlOrMeta+0");
      await page.waitForTimeout(800);
      const src0 = await iframe.getAttribute("src");
      const selection = await selectByClick(page, iframe, sid, row.file);
      expect(selection.length, "a real click selected an object").toBeGreaterThan(0);
      const before = (await control(sid, { path: row.file, method: "document.inspect" })).result;
      const created = await exec(sid, row.file, row.create.command, row.create.params);
      expect(created, JSON.stringify(created)).toMatchObject({ ok: true, app: row.appId });
      const after = (await control(sid, { instance: created.instance, method: "document.inspect" })).result;
      expect(after.history.length).toBeGreaterThan(before.history.length);
      expect(JSON.stringify(after.layers)).toContain(`"id":${row.createdId(created.result)}`);
      // creation selects the new object (spike, docs/craft-web-plugin.md §14.8); a non-creating edit leaves the user's selection alone
      await exec(sid, row.file, "select.set", { ids: selection }, created.instance);
      const renamed = await exec(sid, row.file, "object.setProps", { ids: selection, name: "agent-renamed" }, created.instance);
      expect(renamed.ok, JSON.stringify(renamed)).toBe(true);
      expect((await control(sid, { instance: created.instance, method: "document.inspect" })).result.selection).toEqual(selection);
      expect(await iframe.getAttribute("src")).toBe(src0); // same frame document, never reloaded
    });
  }

  test("every app with a control profile has a live row here", () => {
    const withControl = CRAFT_APP_PROFILES.filter((p) => p.control).map((p) => p.appId);
    expect(CONTROL_ROWS.map((r) => r.appId).sort()).toEqual(withControl.sort());
  });

  test("F3 (8.9): the user's Cmd/Ctrl+Z removes the agent's rectangle", async ({ page }) => {
    const { sid, iframe } = await vectorEditor(page);
    const created = await exec(sid, SVG, "shape.rectangle", { x: 5, y: 5, width: 40, height: 30 });
    expect(created.ok).toBe(true);
    const count = async () => ((await control(sid, { instance: created.instance, method: "document.inspect" })).result.history as unknown[]).length;
    expect(await count()).toBeGreaterThan(0);
    await iframe.click({ position: { x: 20, y: 400 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(count, { timeout: 10_000 }).toBe(0);
  });

  test("X11 (8.17): an agent save with the user's 'Create' writes shapes.vectorcraft, leaves shapes.svg alone, and the tab stays unsaved", async ({ page }) => {
    const { sid } = await vectorEditor(page);
    const before = shaOob(SVG);
    const edit = await exec(sid, SVG, "shape.rectangle", { x: 5, y: 5, width: 40, height: 30 });
    expect(edit.ok).toBe(true);
    const save = await exec(sid, SVG, "file.save", undefined, edit.instance);
    expect(save).toMatchObject({ ok: true, saveRequested: true });
    // VectorCraft's own Save As dialog (default format: .vectorcraft) is in the canvas; press its OK with Enter.
    await page.keyboard.press("Enter");
    const dlg = page.getByTestId("craft-sibling");
    await expect(dlg).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("craft-sibling-create").click();
    await expect.poll(() => existsOob("shapes.vectorcraft"), { timeout: 30_000 }).toBe(true);
    expect(shaOob(SVG)).toBe(before);
    const state = await control(sid, { instance: edit.instance, method: "host.state", params: { sinceSeq: save.saveSeq } });
    expect(state.result.saves.at(-1)).toMatchObject({ outcome: "sibling" });
    expect(state.result.unsaved).toBe(true);
  });

  for (const row of CONTROL_ROWS) {
    test(`X16 (8.20) ${row.appId}: every read-only command leaves the document digest unchanged`, async ({ page }) => {
      const control_ = CRAFT_APP_PROFILES.find((p) => p.appId === row.appId)?.control;
      if (!control_) throw new Error(`${row.appId} has no control profile`);
      const { sid } = await freshEditor(page, row.file, row.claimId);
      const digest = async () => {
        const d = (await control(sid, { path: row.file, method: "document.inspect" })).result;
        return JSON.stringify({ a: d.artboards, l: d.layers, h: d.history, dirty: d.dirty, sel: d.selection, r: d.redo });
      };
      const before = await digest();
      for (const command of control_.readOnlyCommands) {
        const params = command === "document.node" ? { id: 1 } : command === "document.find" ? { name: "a" } : undefined;
        const r = await exec(sid, row.file, command, params);
        expect(r.ok || r.code === "app_error" || r.code === "reply_too_large", `${command}: ${JSON.stringify(r).slice(0, 200)}`).toBe(true);
        expect(await digest(), `${command} changed the document`).toBe(before);
      }
    });
  }
});
