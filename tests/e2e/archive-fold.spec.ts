/**
 * L3 — the per-folder `Archive (N)` fold against the real harness
 * (archive-sessions-lazy-load, test-plan #F4, #F8, #F9, #F10, #X8).
 *
 * Why L3: the fold's contract is a CLIENT/SERVER round-trip that no unit test
 * can prove — the boot sidecar scan must index `archived:true` sidecars into
 * the in-memory archive index, the snapshot must carry their per-folder count,
 * the first expand must issue exactly one `GET /api/sessions/archived` request,
 * restore/delete must mutate the index + the live set, and a read-only open
 * must hydrate the transcript from the index row's `sessionFile` without the
 * session ever entering the live `sessions` map.
 *
 * Exemplar: `tests/e2e/ended-session-endedat.spec.ts` — seeds `.meta.json`
 * sidecars OUT-OF-BAND via `docker exec` (the REST API cannot create an
 * archived sidecar), then `POST /api/restart` so the boot scanner indexes them.
 * Port + compose project come from `.pi-test-harness.json` — never hardcoded.
 *
 * SELF-ISOLATION: the harness is ONE container shared by every spec and the
 * fixture repo persists across runs. Every seeded sidecar carries the
 * `e2e-archfold` name prefix, and `cleanupSeeded()` deletes them (and their
 * `.jsonl`) by that prefix on every entry and exit — so a crashed run heals on
 * the next one and no `-r 2` run ever sees a leftover row.
 *
 * See change: archive-sessions-lazy-load.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { WebSocket } from "ws";
import { expect, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

/** Fixed prefix every seeded session name carries (cleanup selector). */
const ARCHFOLD_PREFIX = "e2e-archfold";
/** User-message text planted in the newest archived transcript (#F10). */
const TRANSCRIPT_MARKER = `${ARCHFOLD_PREFIX}-transcript-marker`;
const HOUR = 60 * 60 * 1000;

/**
 * The harness container id, resolved from the compose project recorded in
 * `.pi-test-harness.json`. `docker compose exec` would need the -f file set;
 * the project label is enough to find the container directly.
 */
let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const project = harnessProject();
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    { encoding: "utf8", timeout: 30_000 },
  ).trim().split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  // Bounded: an unbounded `docker` call would hang the single worker until the
  // Playwright timeout fires, hiding the real cause.
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/**
 * Run a JS snippet inside the container with `node`. The snippet is
 * base64-staged so it may contain any quotes — hand-escaping JSON into a
 * `sh -c 'node -e ...'` nesting is a reliable way to corrupt the seed.
 */
function runNode(script: string): string {
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return inContainer(`node -e 'eval(Buffer.from("${b64}","base64").toString("utf8"))'`);
}

/** pi's on-disk encoding of a cwd into a sessions subdirectory name. */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/** Session id filename timestamp: `2026-03-30T21-39-43-034Z`. */
function fileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

const SESSIONS_REL = `.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;
/** Worktree path used by F15 — folds under its parent repo (`FIXTURE_GIT`). */
const WT_CWD = `${FIXTURE_GIT}/.worktrees/e2e-archfold`;
const WT_SESSIONS_REL = `.pi/agent/sessions/${encodeCwd(WT_CWD)}`;

/** Write `content` to a path expressed relative to the container's `$HOME`. */
function writeHomeFile(relPath: string, content: string): void {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const f=p.join(process.env.HOME,${JSON.stringify(relPath)});` +
      `fs.mkdirSync(p.dirname(f),{recursive:true});` +
      `fs.writeFileSync(f,Buffer.from(${JSON.stringify(b64)},"base64"));`,
  );
}

function homeFileExists(relPath: string): boolean {
  const out = runNode(
    `console.log(require("fs").existsSync(require("path").join(process.env.HOME,${JSON.stringify(relPath)})))`,
  );
  return out.trim() === "true";
}

interface SeedFile {
  id: string;
  jsonlRel: string;
  metaRel: string;
}

/**
 * Plant one session pair (`.jsonl` + `.meta.json`) in the fixture folder.
 *
 * The filename MUST carry pi's `<stamp>_<uuid>.jsonl` shape: `session-scanner`
 * derives the session id from it and skips anything else, so a seed without
 * the underscore would be invisible to the boot archive index.
 */
function seedSession(opts: {
  name: string;
  startedAt: number;
  endedAt: number;
  archived: boolean;
  message?: string;
  /** Defaults to the fixture repo; F15 seeds a worktree cwd instead. */
  cwd?: string;
  gitWorktree?: { mainPath?: string; name?: string };
}): SeedFile {
  const id = crypto.randomUUID();
  const cwd = opts.cwd ?? FIXTURE_GIT;
  const dirRel = `.pi/agent/sessions/${encodeCwd(cwd)}`;
  const fname = `${fileStamp(opts.startedAt)}_${id}.jsonl`;
  const lines: string[] = [
    JSON.stringify({
      type: "session",
      id,
      cwd,
      timestamp: new Date(opts.startedAt).toISOString(),
    }),
  ];
  if (opts.message) {
    lines.push(
      JSON.stringify({
        type: "message",
        id: "u1",
        timestamp: new Date(opts.startedAt + 1_000).toISOString(),
        message: { role: "user", content: [{ type: "text", text: opts.message }] },
      }),
    );
  }
  const jsonlRel = `${dirRel}/${fname}`;
  writeHomeFile(jsonlRel, `${lines.join("\n")}\n`);

  const meta: Record<string, unknown> = {
    cwd,
    status: "ended",
    name: opts.name,
    firstMessage: opts.message ?? opts.name,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
  };
  if (opts.gitWorktree) meta.gitWorktree = opts.gitWorktree;
  if (opts.archived) {
    meta.archived = true;
    meta.archivedAt = opts.endedAt;
  }
  const metaRel = `${dirRel}/${fname.replace(/\.jsonl$/, ".meta.json")}`;
  writeHomeFile(metaRel, `${JSON.stringify(meta, null, 2)}\n`);
  return { id, jsonlRel, metaRel };
}

/**
 * Delete every seeded sidecar + transcript under the fixture folder.
 *
 * Selector is the SESSION NAME prefix, not a tracked path list: the files a
 * crashed run left behind carry no in-memory record, and the fixed prefix is
 * what makes a re-run self-healing.
 */
function cleanupSeeded(): void {
  for (const rel of [SESSIONS_REL, WT_SESSIONS_REL]) {
    runNode(
      `const fs=require("fs"),p=require("path");` +
        `const d=p.join(process.env.HOME,${JSON.stringify(rel)});` +
        `if(!fs.existsSync(d))process.exit(0);` +
        `for(const f of fs.readdirSync(d)){` +
        `if(!f.endsWith(".meta.json"))continue;` +
        `try{const m=JSON.parse(fs.readFileSync(p.join(d,f),"utf8"));` +
        `if(typeof m.name==="string"&&m.name.startsWith(${JSON.stringify(ARCHFOLD_PREFIX)})){` +
        `const base=f.slice(0,-".meta.json".length);` +
        `for(const ext of [".meta.json",".jsonl"]){try{fs.unlinkSync(p.join(d,base+ext))}catch{}}}}catch{}}`,
    );
  }
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  const deadline = Date.now() + 150_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

interface Seeded {
  /** Archived ids, newest-ended first (the fold's render order). */
  archived: string[];
  /** The resident ended session that gives the folder a live group. */
  resident: string;
}

/**
 * Clean, seed 3 archived + 1 resident ended sidecar in the fixture folder, then
 * restart so the boot scanner builds the archive index. Newest archived row
 * (index 0) carries the transcript marker for the read-only-open scenario.
 */
async function seedAndRestart(): Promise<Seeded> {
  cleanupSeeded();
  const now = Date.now();
  // The resident ended session keeps the folder a NON-stub group (a group the
  // client holds no session for renders header + ended fold only, with no
  // archive fold).
  const resident = seedSession({
    name: `${ARCHFOLD_PREFIX}-resident`,
    startedAt: now - 4 * HOUR,
    endedAt: now - 3 * HOUR,
    archived: false,
  }).id;
  const archived = [
    seedSession({
      name: `${ARCHFOLD_PREFIX}-newest`,
      startedAt: now - 3 * HOUR,
      endedAt: now - 1 * HOUR,
      archived: true,
      message: TRANSCRIPT_MARKER,
    }).id,
    seedSession({
      name: `${ARCHFOLD_PREFIX}-middle`,
      startedAt: now - 5 * HOUR,
      endedAt: now - 2 * HOUR,
      archived: true,
    }).id,
    seedSession({
      name: `${ARCHFOLD_PREFIX}-oldest`,
      startedAt: now - 7 * HOUR,
      endedAt: now - 3 * HOUR,
      archived: true,
    }).id,
  ];
  await restartDashboard();
  return { archived, resident };
}

const archiveToggle = (page: Page) => page.getByTestId(`folder-archive-toggle-${FIXTURE_GIT}`);
const archiveRows = (page: Page) => page.getByTestId("archived-session-row");
const archivedRow = (page: Page, id: string) =>
  page.locator(`[data-testid="archived-session-row"][data-archived-id="${id}"]`);

/** The fixture folder renders expanded by default (fresh context, empty
 *  `collapsedGroups`); guard against a hidden initial collapse. */
async function ensureFolderExpanded(page: Page): Promise<void> {
  await page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).waitFor({ state: "visible", timeout: 30_000 });
  const body = page.getByTestId(`folder-body-${FIXTURE_GIT}`);
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await body.count()) > 0) return;
    // The card root is the innermost DOM node holding BOTH the home row and the
    // toggle — `.last()` picks that innermost match in document order.
    const card = page
      .locator("div")
      .filter({ has: page.getByTestId(`folder-home-row-${FIXTURE_GIT}`) })
      .filter({ has: page.getByTestId("folder-toggle-btn") })
      .last();
    await card.getByTestId("folder-toggle-btn").click();
    const ok = await expect
      .poll(async () => body.count(), { timeout: 5_000 })
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error(`folder ${FIXTURE_GIT} never expanded`);
}

// ── P3 helpers (snapshot size) ────────────────────────────────────────────

/** Set `sessionList.archiveAfterDays` in the harness config file. */
function setArchiveAfterDays(days: number): void {
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const f=p.join(process.env.HOME,".pi/dashboard/config.json");` +
      `const c=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};` +
      `c.sessionList=c.sessionList||{};c.sessionList.archiveAfterDays=${days};` +
      `fs.writeFileSync(f,JSON.stringify(c,null,2));`,
  );
}

/**
 * Bulk-plant `count` `status:"idle"` sidecars aged `ageDays` into the fixture
 * folder in ONE container node script (per-file `docker exec` would be minutes),
 * returning their ids. Names carry the cleanup prefix so `cleanupSeeded` heals.
 */
function bulkSeedOldSessions(count: number, ageDays: number): string[] {
  const now = Date.now();
  const script =
    `const fs=require("fs"),p=require("path"),crypto=require("crypto");` +
    `const dir=p.join(process.env.HOME,${JSON.stringify(SESSIONS_REL)});` +
    `fs.mkdirSync(dir,{recursive:true});` +
    `const ids=[];const now=${now};const DAY=86400000;` +
    `const stamp=(ms)=>new Date(ms).toISOString().replace(/:/g,"-").replace(/\./g,"-");` +
    `for(let i=0;i<${count};i++){` +
    `const id=crypto.randomUUID();ids.push(id);` +
    `const t=now-${ageDays}*DAY-i*1000;` +
    `const base=stamp(t)+"_"+id;` +
    `const jsonl=JSON.stringify({type:"session",id,cwd:${JSON.stringify(FIXTURE_GIT)},timestamp:new Date(t).toISOString()})+"\\n";` +
    `const jsonlPath=p.join(dir,base+".jsonl");` +
    `fs.writeFileSync(jsonlPath,jsonl);` +
    `fs.writeFileSync(p.join(dir,base+".meta.json"),JSON.stringify({cwd:${JSON.stringify(FIXTURE_GIT)},status:"idle",name:${JSON.stringify(ARCHFOLD_PREFIX)}+"-p3-"+i,startedAt:t}));` +
    `fs.utimesSync(jsonlPath,t/1000,t/1000);` +
    `}` +
    `console.log(JSON.stringify(ids));`;
  return JSON.parse(runNode(script)) as string[];
}

async function waitForResident(ids: string[], present: boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  for (;;) {
    const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/sessions`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const live = new Set((body.data ?? []).map((s) => s.id));
    count = ids.filter((id) => live.has(id)).length;
    if (present ? count === ids.length : count === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`waitForResident timed out: present=${present} count=${count}/${ids.length}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** First `sessions_snapshot` frame: its byte size and the ids it carries. */
function firstSnapshot(): Promise<{ bytes: number; ids: Set<string> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${DASHBOARD_PORT}/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("no sessions_snapshot frame within 20s"));
    }, 20_000);
    ws.on("message", (data) => {
      const s = data.toString();
      if (!s.includes("sessions_snapshot")) return;
      clearTimeout(timer);
      const msg = JSON.parse(s) as { sessions?: Array<{ id: string }> };
      resolve({ bytes: Buffer.byteLength(s, "utf8"), ids: new Set((msg.sessions ?? []).map((x) => x.id)) });
      ws.close();
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Count live `session_added` frames for the ids an archived fold must never add. */
function trackSessionAdded(page: Page): string[] {
  const ids: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (!payload.includes("session_added")) return;
      try {
        const msg = JSON.parse(payload) as { session?: { id?: string } };
        if (msg.session?.id) ids.push(msg.session.id);
      } catch {
        /* non-JSON frame: not ours */
      }
    });
  });
  return ids;
}

async function liveSessionIds(page: Page): Promise<Set<string>> {
  const res = await page.request.get("/api/sessions");
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return new Set((body.data ?? []).map((s) => s.id));
}

test.describe("archive fold (archive-sessions-lazy-load)", () => {
  test.setTimeout(240_000);

  test.afterEach(() => {
    try {
      cleanupSeeded();
    } catch {
      /* teardown best-effort — the next run's entry cleanup heals */
    }
  });

  test("F4: first expand lazily fetches exactly one page and never adds archived ids", async ({ page }) => {
    const { archived } = await seedAndRestart();
    const added = trackSessionAdded(page);
    const listRequests: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "GET" && req.url().includes("/api/sessions/archived?")) {
        listRequests.push(req.url());
      }
    });

    await gotoDashboard(page);
    await ensureFolderExpanded(page);
    await expect(archiveToggle(page)).toBeVisible({ timeout: 30_000 });
    await expect(archiveToggle(page)).toContainText("Archive (3)");

    // Record whether the loading skeletons ever mounted. They are transient
    // (the index is served with no disk IO), so a poll after the click races
    // them away; a MutationObserver sees the commit that a poll cannot.
    await page.evaluate(() => {
      (window as unknown as { __sawArchiveSkeleton: boolean }).__sawArchiveSkeleton = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="archive-skeleton-row"]')) {
          (window as unknown as { __sawArchiveSkeleton: boolean }).__sawArchiveSkeleton = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    await archiveToggle(page).click();
    await expect(archiveRows(page)).toHaveCount(3, { timeout: 30_000 });

    // Exactly ONE listing request for the expand — the fold is lazy (per-fold,
    // per-key) and the count map did not churn a second fetch into being.
    const forFolder = listRequests.filter((u) =>
      u.includes(`cwd=${encodeURIComponent(FIXTURE_GIT)}`),
    );
    expect(
      forFolder.length,
      `expected exactly one GET /api/sessions/archived for ${FIXTURE_GIT}, saw ${JSON.stringify(forFolder)}`,
    ).toBe(1);

    expect(
      await page.evaluate(
        () => (window as unknown as { __sawArchiveSkeleton: boolean }).__sawArchiveSkeleton,
      ),
      "the fold showed no loading skeleton before the rows arrived",
    ).toBe(true);
    await expect(page.getByTestId("archive-skeleton-row")).toHaveCount(0);

    // Rendering archived rows must NOT push them into the live session set.
    const live = await liveSessionIds(page);
    for (const id of archived) {
      expect(live.has(id), `archived ${id} leaked into GET /api/sessions`).toBe(false);
      expect(added, `a session_added frame carried archived ${id}`).not.toContain(id);
      await expect(page.locator(`[data-session-id="${id}"]`)).toHaveCount(0);
    }
  });

  test("F8: restore from a row removes it, decrements the fold, and makes the session live-ended", async ({ page }) => {
    const { archived } = await seedAndRestart();
    const restoredId = archived[0];
    await gotoDashboard(page);
    await ensureFolderExpanded(page);

    // Expand the ended tier so the restored card has somewhere visible to land.
    await page.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`).click();

    await expect(archiveToggle(page)).toBeVisible({ timeout: 30_000 });
    await archiveToggle(page).click();
    await expect(archiveRows(page)).toHaveCount(3, { timeout: 30_000 });

    await archivedRow(page, restoredId).getByTestId("session-unarchive-btn").click();

    await expect(archivedRow(page, restoredId)).toHaveCount(0, { timeout: 20_000 });
    await expect(archiveToggle(page)).toContainText("Archive (2)", { timeout: 20_000 });
    await expect(archiveRows(page)).toHaveCount(2, { timeout: 20_000 });

    // The restored session is a resident ENDED session now, under the folder.
    await expect(page.locator(`[data-session-id="${restoredId}"]`)).toBeVisible({ timeout: 20_000 });
    const live = await liveSessionIds(page);
    expect(live.has(restoredId), "GET /api/sessions lacks the restored session").toBe(true);
  });

  test("F9: delete from a row removes the transcript + sidecar and decrements the fold", async ({ page }) => {
    const { archived } = await seedAndRestart();
    const deletedId = archived[0];
    // Re-derive the on-disk paths the same way the seeder does (stamp is
    // time-based, so read the sidecar's own directory entry instead of guessing).
    const seededFiles = runNode(
      `const fs=require("fs"),p=require("path");` +
        `const d=p.join(process.env.HOME,".pi/agent/sessions",${JSON.stringify(encodeCwd(FIXTURE_GIT))});` +
        `const out=[];` +
        `for(const f of fs.readdirSync(d)){if(!f.endsWith(".meta.json"))continue;` +
        `try{const m=JSON.parse(fs.readFileSync(p.join(d,f),"utf8"));` +
        `if(m.name===${JSON.stringify(`${ARCHFOLD_PREFIX}-newest`)}){out.push(f.slice(0,-".meta.json".length))}}catch{}}` +
        `console.log(JSON.stringify(out));`,
    );
    const bases = JSON.parse(seededFiles) as string[];
    expect(bases.length, "the newest seed's sidecar was not found on disk").toBe(1);
    const jsonlRel = `${SESSIONS_REL}/${bases[0]}.jsonl`;
    const metaRel = `${SESSIONS_REL}/${bases[0]}.meta.json`;
    expect(homeFileExists(jsonlRel), "seed .jsonl missing before delete").toBe(true);
    expect(homeFileExists(metaRel), "seed .meta.json missing before delete").toBe(true);

    await gotoDashboard(page);
    await ensureFolderExpanded(page);
    await expect(archiveToggle(page)).toBeVisible({ timeout: 30_000 });
    await archiveToggle(page).click();
    await expect(archiveRows(page)).toHaveCount(3, { timeout: 30_000 });

    await archivedRow(page, deletedId).getByTestId("archived-delete-btn").click();
    await expect(page.getByTestId("archived-delete-confirm")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("archived-delete-confirm-action").click();

    await expect(archivedRow(page, deletedId)).toHaveCount(0, { timeout: 20_000 });
    await expect(archiveToggle(page)).toContainText("Archive (2)", { timeout: 20_000 });
    await expect(archiveRows(page)).toHaveCount(2, { timeout: 20_000 });

    expect(homeFileExists(jsonlRel), "the deleted session's .jsonl still exists").toBe(false);
    expect(homeFileExists(metaRel), "the deleted session's .meta.json still exists").toBe(false);
    const live = await liveSessionIds(page);
    expect(live.has(deletedId)).toBe(false);
  });

  test("F10: clicking a row opens the read-only archived view, survives reload, stays out of the live set", async ({ page }) => {
    const { archived } = await seedAndRestart();
    const openedId = archived[0];
    await gotoDashboard(page);
    await ensureFolderExpanded(page);
    await expect(archiveToggle(page)).toBeVisible({ timeout: 30_000 });
    await archiveToggle(page).click();
    await expect(archiveRows(page)).toHaveCount(3, { timeout: 30_000 });

    await archivedRow(page, openedId).click();
    await expect(page).toHaveURL(new RegExp(`/session/${openedId}\\?archived=1`), { timeout: 20_000 });
    // Transcript region renders and is hydrated from the index row's
    // `sessionFile` (the marker message is only in the seeded `.jsonl`).
    await expect(page.getByTestId("chat-scroll-container")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(TRANSCRIPT_MARKER).first()).toBeVisible({ timeout: 20_000 });
    // Read-only: the composer (and its send button) is never mounted.
    await expect(page.getByTestId("send-button")).toHaveCount(0);

    // Reload must re-open the same read-only view via /api/sessions/archived/:id.
    const byIdRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(`/api/sessions/archived/${openedId}`)) byIdRequests.push(req.url());
    });
    await page.reload();
    await expect(page.getByTestId("chat-scroll-container")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/session/${openedId}\\?archived=1`));
    await expect(page.getByTestId("send-button")).toHaveCount(0);
    await expect
      .poll(() => byIdRequests.length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    // The whole point: the read-only open never enrolls the id in the live set.
    const live = await liveSessionIds(page);
    expect(live.has(openedId), "read-only open leaked into GET /api/sessions").toBe(false);
  });

  test("X8: a 500 on the listing shows the retry control; retry loads the rows", async ({ page }) => {
    await seedAndRestart();
    await gotoDashboard(page);
    await ensureFolderExpanded(page);
    await expect(archiveToggle(page)).toBeVisible({ timeout: 30_000 });

    await page.route("**/api/sessions/archived*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "stubbed failure" }),
      }),
    );

    await archiveToggle(page).click();
    const retry = page.getByTestId(`folder-archive-retry-${FIXTURE_GIT}`);
    await expect(retry).toBeVisible({ timeout: 30_000 });
    await expect(archiveRows(page)).toHaveCount(0);
    await expect(page.getByTestId("archive-skeleton-row")).toHaveCount(0);

    await page.unroute("**/api/sessions/archived*");
    await retry.click();
    await expect(archiveRows(page)).toHaveCount(3, { timeout: 30_000 });
    await expect(retry).toHaveCount(0);
  });

  test("F14: archiving from one client evicts the card and bumps the fold in another", async ({ browser }) => {
    cleanupSeeded();
    const now = Date.now();
    const resident = seedSession({
      name: `${ARCHFOLD_PREFIX}-evictable`,
      startedAt: now - 2 * HOUR,
      endedAt: now - 1 * HOUR,
      archived: false,
    }).id;
    // A second resident keeps the folder a non-stub group after the archive —
    // archiving the ONLY resident makes the whole fold disappear.
    seedSession({ name: `${ARCHFOLD_PREFIX}-stayer`, startedAt: now - 6 * HOUR, endedAt: now - 5 * HOUR, archived: false });
    seedSession({ name: `${ARCHFOLD_PREFIX}-keep`, startedAt: now - 4 * HOUR, endedAt: now - 3 * HOUR, archived: true });
    await restartDashboard();

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    try {
      await gotoDashboard(a);
      await gotoDashboard(b);
      await ensureFolderExpanded(a);
      await ensureFolderExpanded(b);
      // Reveal the resident ended card in both contexts.
      await a.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`).click();
      await b.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`).click();
      await expect(a.locator(`[data-session-id="${resident}"]`)).toBeVisible({ timeout: 20_000 });
      await expect(b.locator(`[data-session-id="${resident}"]`)).toBeVisible({ timeout: 20_000 });
      await expect(archiveToggle(a)).toContainText("Archive (1)");
      await expect(archiveToggle(b)).toContainText("Archive (1)");

      await a.locator(`[data-session-id="${resident}"]`).getByTestId("session-archive-btn").click();

      // A is the actor; B must observe the same eviction + count via broadcast.
      await expect(a.locator(`[data-session-id="${resident}"]`)).toHaveCount(0, { timeout: 20_000 });
      await expect(archiveToggle(a)).toContainText("Archive (2)", { timeout: 20_000 });
      await expect(b.locator(`[data-session-id="${resident}"]`)).toHaveCount(0, { timeout: 20_000 });
      await expect(archiveToggle(b)).toContainText("Archive (2)", { timeout: 20_000 });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("F15: an archived worktree session folds under its parent repo", async ({ page }) => {
    cleanupSeeded();
    const now = Date.now();
    seedSession({
      name: `${ARCHFOLD_PREFIX}-repo-resident`,
      startedAt: now - 2 * HOUR,
      endedAt: now - 1 * HOUR,
      archived: false,
    });
    seedSession({
      name: `${ARCHFOLD_PREFIX}-worktree`,
      startedAt: now - 5 * HOUR,
      endedAt: now - 2 * HOUR,
      archived: true,
      cwd: WT_CWD,
      gitWorktree: { mainPath: FIXTURE_GIT, name: "e2e-archfold" },
    });
    await restartDashboard();

    await gotoDashboard(page);
    await ensureFolderExpanded(page);
    await expect(archiveToggle(page)).toBeVisible({ timeout: 30_000 });
    await expect(archiveToggle(page)).toContainText("Archive (1)");
    // No separate fold keyed by the worktree path — the row folded under the repo.
    await expect(page.getByTestId(`folder-archive-toggle-${WT_CWD}`)).toHaveCount(0);
    await archiveToggle(page).click();
    await expect(archiveRows(page)).toHaveCount(1, { timeout: 30_000 });
  });

  test("P3: 400 aged sessions are archived at boot — absent from /api/sessions and the snapshot, present in the index", async () => {
    test.setTimeout(300_000);
    cleanupSeeded();
    setArchiveAfterDays(30);
    const seeded = bulkSeedOldSessions(400, 45);
    await restartDashboard();
    // Archived (not resident) once the boot scan settles.
    await waitForResident(seeded, false, 120_000);
    const snap = await firstSnapshot();
    expect(snap.ids.size, "the snapshot frame carried no sessions at all").toBeGreaterThan(0);
    expect(
      seeded.filter((id) => snap.ids.has(id)).length,
      "archived sessions leaked into the snapshot frame",
    ).toBe(0);

    // On-demand listing still serves them from the archive index.
    const res = await fetch(
      `http://localhost:${DASHBOARD_PORT}/api/sessions/archived?cwd=${encodeURIComponent(FIXTURE_GIT)}&limit=200`,
    );
    const body = (await res.json()) as { data?: { items?: Array<{ id: string }> } };
    const indexed = new Set((body.data?.items ?? []).map((i) => i.id));
    expect(
      seeded.filter((id) => indexed.has(id)).length,
      "aged sessions were not served from the archive index",
    ).toBeGreaterThan(0);
  });
});
