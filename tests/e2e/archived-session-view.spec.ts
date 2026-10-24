/**
 * L3 — the read-only archived session view (`/session/:id?archived=1`):
 * header, editor-pane cwd and the stale-artifact tab swap against the real
 * harness (fix-archived-session-view-header-and-stale-artifact-tab,
 * test-plan #F1–#F4, #X3, #X4).
 *
 * Why L3: the contract spans the summary fetch (`/api/sessions/archived/:id`),
 * the persisted editor-pane tab, `/api/file` (400 on an empty cwd) and the
 * OpenSpec archive listing — no unit test sees them together.
 *
 * Seeding: archived sidecar via `docker exec` + `POST /api/restart` (exemplar
 * `archive-fold.spec.ts`); the change moved into `archive/<today>-<name>` via
 * `docker exec` (exemplar `archived-attachment.spec.ts`). Port and compose
 * project come from `.pi-test-harness.json`.
 *
 * SELF-ISOLATION: every seeded session name carries `e2e-archview`; cleanup
 * deletes by that prefix on entry and exit, and removes the seeded change dirs.
 *
 * See change: fix-archived-session-view-header-and-stale-artifact-tab.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { expect, type Page, test } from "./fixtures.js";
import { armFirstLaunchDismiss, FIXTURE_GIT } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

const PREFIX = "e2e-archview";
const NAME = `${PREFIX}-archived`;
const CHANGE = "e2e-stale";
const CHANGES_DIR = `${FIXTURE_GIT}/openspec/changes`;
const STALE_PATH = `openspec/changes/${CHANGE}/proposal.md`;
const HEADING = "E2E stale proposal heading";
const HOUR = 60 * 60 * 1000;

let containerId: string | undefined;
function inContainer(script: string): string {
  if (!containerId) {
    const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
      encoding: "utf8",
      timeout: 30_000,
    })
      .trim()
      .split("\n")[0];
    if (!id) throw new Error("no running harness container");
    containerId = id;
  }
  return execFileSync("docker", ["exec", containerId, "sh", "-c", script], { encoding: "utf8", timeout: 60_000 }).trim();
}

function runNode(script: string): string {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return inContainer(`node -e 'eval(Buffer.from("${b64}","base64").toString("utf8"))'`);
}

const encodeCwd = (cwd: string) => `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
const fileStamp = (ms: number) => new Date(ms).toISOString().replace(/:/g, "-").replace(/\./g, "-");
const SESSIONS_REL = `.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;

function writeHomeFile(relPath: string, content: string): void {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const f=p.join(process.env.HOME,${JSON.stringify(relPath)});` +
      `fs.mkdirSync(p.dirname(f),{recursive:true});` +
      `fs.writeFileSync(f,Buffer.from(${JSON.stringify(b64)},"base64"));`,
  );
}

/** Plant one archived session pair; the filename must carry pi's `<stamp>_<uuid>.jsonl` shape. */
function seedArchivedSession(): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  const startedAt = now - 3 * HOUR;
  const endedAt = now - 1 * HOUR;
  const fname = `${fileStamp(startedAt)}_${id}`;
  writeHomeFile(
    `${SESSIONS_REL}/${fname}.jsonl`,
    `${JSON.stringify({ type: "session", id, cwd: FIXTURE_GIT, timestamp: new Date(startedAt).toISOString() })}\n`,
  );
  writeHomeFile(
    `${SESSIONS_REL}/${fname}.meta.json`,
    `${JSON.stringify({ cwd: FIXTURE_GIT, status: "ended", name: NAME, firstMessage: NAME, startedAt, endedAt, archived: true, archivedAt: endedAt }, null, 2)}\n`,
  );
  return id;
}

function cleanupSeeded(): void {
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const d=p.join(process.env.HOME,${JSON.stringify(SESSIONS_REL)});` +
      `if(!fs.existsSync(d))process.exit(0);` +
      `for(const f of fs.readdirSync(d)){if(!f.endsWith(".meta.json"))continue;` +
      `try{const m=JSON.parse(fs.readFileSync(p.join(d,f),"utf8"));` +
      `if(typeof m.name==="string"&&m.name.startsWith(${JSON.stringify(PREFIX)})){` +
      `const b=f.slice(0,-".meta.json".length);for(const e of [".meta.json",".jsonl"]){try{fs.unlinkSync(p.join(d,b+e))}catch{}}}}catch{}}`,
  );
}

function cleanupChange(): void {
  inContainer(`rm -rf "${CHANGES_DIR}/${CHANGE}" "${CHANGES_DIR}"/archive/*-${CHANGE}`);
}

/** The change exists ONLY under `archive/<today>-<name>`, as after `openspec archive`. Returns the entry name. */
function seedArchivedChange(): string {
  cleanupChange();
  const today = inContainer("date +%F");
  const entry = `${today}-${CHANGE}`;
  inContainer(
    `mkdir -p "${CHANGES_DIR}/archive/${entry}" && printf '# ${HEADING}\\n\\nBody.\\n' > "${CHANGES_DIR}/archive/${entry}/proposal.md"`,
  );
  return entry;
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`)).ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

/** Persist a restored stale tab + an open split for the session, before any page script runs. */
async function persistStaleTab(page: Page, id: string): Promise<void> {
  await page.addInitScript(
    ({ id, path }) => {
      localStorage.setItem(
        `pi-dashboard:editor-pane:${id}`,
        JSON.stringify({ openFiles: [{ path, viewer: "markdown", addedAt: 1 }], activeIndex: 0, treeOpenRoots: [] }),
      );
      localStorage.setItem(`pi-dashboard:split:${id}`, JSON.stringify({ mode: "split", ratio: 0.5, orientation: "h" }));
    },
    { id, path: STALE_PATH },
  );
}

/** Record every `/api/file` request's `cwd` query value. */
function recordFileCwds(page: Page): string[] {
  const cwds: string[] = [];
  page.on("request", (req) => {
    const u = new URL(req.url());
    if (u.pathname === "/api/file") cwds.push(u.searchParams.get("cwd") ?? "");
  });
  return cwds;
}

/** Install a MutationObserver flagging any "No session selected" text across the load. */
async function watchNoSessionSelected(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __noSession: boolean }).__noSession = false;
    const check = () => {
      if (document.body?.textContent?.includes("No session selected")) (window as unknown as { __noSession: boolean }).__noSession = true;
    };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
const sawNoSession = (page: Page) => page.evaluate(() => (window as unknown as { __noSession: boolean }).__noSession);

test.describe("archived session view (fix-archived-session-view-header-and-stale-artifact-tab)", () => {
  test.setTimeout(240_000);
  let sessionId: string;

  test.beforeAll(async () => {
    cleanupSeeded();
    sessionId = seedArchivedSession();
    await restartDashboard();
  });
  test.afterAll(() => {
    cleanupSeeded();
    cleanupChange();
  });
  // The first-launch display modal would cover the page (its backdrop intercepts clicks).
  test.beforeEach(async ({ page }) => armFirstLaunchDismiss(page));
  test.afterEach(() => cleanupChange());

  test("F1: embed mode shows the header (name, layout switch, embed exit), never No session selected", async ({ page }) => {
    await watchNoSessionSelected(page);
    await page.goto(`/session/${sessionId}?archived=1&embed=1`);
    const header = page.getByTestId("session-header");
    await expect(header).toContainText(NAME, { timeout: 30_000 });
    await expect(page.getByTestId("layout-mode-switch").first()).toBeVisible();
    await expect(page.getByTestId("embed-exit")).toBeVisible();
    expect(await sawNoSession(page)).toBe(false);
  });

  test("F2: outside embed mode the header shows the name and layout switch", async ({ page }) => {
    await watchNoSessionSelected(page);
    await page.goto(`/session/${sessionId}?archived=1&embed=0`);
    await expect(page.getByTestId("session-header")).toContainText(NAME, { timeout: 30_000 });
    await expect(page.getByTestId("layout-mode-switch").first()).toBeVisible();
    expect(await sawNoSession(page)).toBe(false);
  });

  test("F3: the header carries no mutating controls", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(`/session/${sessionId}?archived=1`);
    await expect(page.getByTestId("session-header")).toContainText(NAME, { timeout: 30_000 });
    for (const id of ["session-header-seek-card", "header-resume-button", "header-fork-button"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await page.getByTestId("session-title-menu").click();
    const menu = page.getByTestId("session-title-menu-list");
    await expect(menu).toBeVisible();
    await expect(menu).not.toContainText(/Rename|Reveal in sidebar|Edit tags/);
  });

  test("F4: a stale proposal tab offers the archived copy and swaps to it", async ({ page }) => {
    const entry = seedArchivedChange();
    await persistStaleTab(page, sessionId);
    const cwds = recordFileCwds(page);
    await page.goto(`/session/${sessionId}?archived=1`);
    const missing = page.getByTestId("editor-file-missing");
    await expect(missing).toContainText(`File no longer exists: ${STALE_PATH}`, { timeout: 30_000 });
    await expect(missing).toContainText(entry);
    await expect(page.getByText("HTTP 400")).toHaveCount(0);
    expect(cwds.length).toBeGreaterThan(0);
    expect(cwds.every((c) => c !== "")).toBe(true);

    await page.getByTestId("editor-open-archived").click();
    await expect(page.getByText(HEADING)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("editor-file-missing")).toHaveCount(0);
    const paths = await page.evaluate(
      (id) => (JSON.parse(localStorage.getItem(`pi-dashboard:editor-pane:${id}`) ?? "{}").openFiles ?? []).map((f: { path: string }) => f.path),
      sessionId,
    );
    expect(paths).toEqual([`openspec/changes/archive/${entry}/proposal.md`]);
  });

  test("X3: while the summary is held the header says Loading and no empty-cwd file request is made", async ({ page }) => {
    const entry = seedArchivedChange();
    await persistStaleTab(page, sessionId);
    const cwds = recordFileCwds(page);
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(`**/api/sessions/archived/${sessionId}`, async (route) => {
      await Promise.race([held, new Promise((r) => setTimeout(r, 3_000))]);
      await route.continue();
    });
    await watchNoSessionSelected(page);
    await page.goto(`/session/${sessionId}?archived=1`);
    await expect(page.getByText("Loading archived session…").first()).toBeVisible({ timeout: 15_000 });
    expect(cwds.filter((c) => c === "")).toEqual([]);
    release();
    await expect(page.getByTestId("session-header")).toContainText(NAME, { timeout: 30_000 });
    await expect(page.getByTestId("editor-file-missing")).toContainText(entry, { timeout: 30_000 });
    expect(cwds.filter((c) => c === "")).toEqual([]);
    expect(await sawNoSession(page)).toBe(false);
  });

  test("X4: a failed summary fetch shows Archived session unavailable and issues no empty-cwd request", async ({ page }) => {
    seedArchivedChange();
    await persistStaleTab(page, sessionId);
    const cwds = recordFileCwds(page);
    await page.route(`**/api/sessions/archived/${sessionId}`, (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: "not found" }) }),
    );
    await watchNoSessionSelected(page);
    await page.goto(`/session/${sessionId}?archived=1`);
    await expect(page.getByTestId("archived-header-placeholder")).toHaveText("Archived session unavailable", { timeout: 30_000 });
    await expect(page.getByTestId("editor-pane-cwd-pending")).toHaveText("Archived session unavailable");
    expect(cwds.filter((c) => c === "")).toEqual([]);
    expect(await sawNoSession(page)).toBe(false);
  });
});
