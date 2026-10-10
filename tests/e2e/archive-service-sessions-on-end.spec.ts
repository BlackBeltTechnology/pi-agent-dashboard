/**
 * L3 — a finished automation run session declared `archiveOnEnd` leaves the
 * board for the folder's `Archive (N)` fold, the Automation view still lists
 * the run, and the run monitor resolves the archived run from the run store
 * and links its read-only transcript.
 *
 * Why L3: the path crosses the persisted declaration (`.meta.json`), the boot
 * scan's service-session reclaim, the archive index, the client's folder board
 * and fold, the automation plugin's result route and its run monitor overlay —
 * no unit test spans that.
 *
 * Seeded, not fired: in the harness the automation engine's init currently
 * fails (`Fastify instance is already listening … addHook`, the same root as
 * the #683 quarantine of `automation-fanout.spec.ts` F5), so a live run never
 * reaches `agent_end`. The declared run session is therefore seeded ended-but-
 * unarchived — exactly what a server stop inside the 30 s grace window leaves
 * behind — and reclaimed by the boot scan's declared leg. The runtime on-end
 * timer is covered at L1 (`archive-sweeper.test.ts`, `archive-on-end-wiring.test.ts`).
 *
 * Exemplars: `automation-identity-restart.spec.ts` (sidecar seeding via
 * `docker exec` + `POST /api/restart`), `archive-fold.spec.ts` (`Archive (N)`
 * fold, read-only `?archived=1` view). Port + compose project come from
 * `.pi-test-harness.json` — never hardcoded.
 *
 * SELF-ISOLATION: every seeded sidecar carries the `e2e-svc-archive` name
 * prefix and every run dir / automation the same prefix; `cleanupSeeded()`
 * removes them on entry and exit, so a crashed run heals on the next one.
 *
 * See change: archive-service-sessions-on-end (test-plan #F1, #F5).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { expect, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

const PREFIX = "e2e-svc-archive";
const HOUR = 60 * 60 * 1000;

/** Mirror of packages/client/src/lib/util/folder-encoding.ts::encodeFolderPath (base64url). */
function encodeFolderPath(cwd: string): string {
  return Buffer.from(cwd, "utf8").toString("base64url");
}

let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const project = harnessProject();
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${project}`);
  containerId = id;
  return id;
}

/** Run a JS snippet inside the container (piped on stdin — no shell quoting, no eval). */
function runNode(script: string): string {
  return execFileSync("docker", ["exec", "-i", harnessContainer(), "node"], {
    input: script,
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/** pi's on-disk encoding of a cwd into a sessions subdirectory name. */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

const SESSIONS_REL = `.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;
const RUNS_ABS = `${FIXTURE_GIT}/.pi/automation/runs`;

/** Write files: `[path, content]` pairs; a relative path is under `$HOME`. */
function writeFiles(files: Array<[string, string]>): void {
  const payload = files.map(([p, c]) => [p, Buffer.from(c, "utf8").toString("base64")]);
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `for(const [rel,b64] of ${JSON.stringify(payload)}){` +
      `const f=p.isAbsolute(rel)?rel:p.join(process.env.HOME,rel);` +
      `fs.mkdirSync(p.dirname(f),{recursive:true});` +
      `fs.writeFileSync(f,Buffer.from(b64,"base64"));}`,
  );
}

interface Seeded {
  sessionId: string;
  parentRunId: string;
  childRunId: string;
  automation: string;
}

/**
 * Seed one ended, unarchived, declared-disposable automation run session
 * (`archiveOnEnd: true`, `live: false`, 1 h old — far younger than the 30 d
 * age threshold, so only the service reclaim can archive it) plus its run-store
 * parent + child records and `result.md`.
 */
function seedDeclaredRun(): Seeded {
  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const automation = `${PREFIX}-${sessionId.slice(0, 8)}`;
  const parentRunId = `2026-01-01-000000-${automation}-00001`;
  const childRunId = `2026-01-01-000000-${automation}-00002`;
  const startedAt = now - 2 * HOUR;
  const endedAt = now - HOUR;
  const stamp = new Date(startedAt).toISOString().replace(/:/g, "-").replace(/\./g, "-");
  const fname = `${stamp}_${sessionId}`;
  const automationRun = { name: automation, runId: childRunId, visibility: "shown" };
  const parentDir = `${RUNS_ABS}/${parentRunId}`;
  const childDir = `${parentDir}/${childRunId}`;
  writeFiles([
    [
      `${SESSIONS_REL}/${fname}.jsonl`,
      `${[
        JSON.stringify({ type: "session", id: sessionId, cwd: FIXTURE_GIT, timestamp: new Date(startedAt).toISOString() }),
        JSON.stringify({ type: "message", message: { role: "user", content: `${PREFIX} transcript marker` } }),
      ].join("\n")}\n`,
    ],
    [
      `${SESSIONS_REL}/${fname}.meta.json`,
      `${JSON.stringify(
        {
          cwd: FIXTURE_GIT,
          status: "ended",
          live: false,
          name: automation,
          firstMessage: automation,
          startedAt,
          endedAt,
          kind: "automation",
          automationRun,
          lifecyclePolicy: "ephemeral",
          recover: false,
          archiveOnEnd: true,
        },
        null,
        2,
      )}\n`,
    ],
    [
      `${parentDir}/run.json`,
      JSON.stringify({ runId: parentRunId, name: automation, status: "done", dir: parentDir, startedAt, endedAt, findings: 1, children: [childRunId] }),
    ],
    [
      `${childDir}/run.json`,
      JSON.stringify({ runId: childRunId, name: automation, status: "done", dir: childDir, startedAt, endedAt, findings: 1, parentRunId, sessionId }),
    ],
    [`${childDir}/result.md`, `- ${PREFIX} finding\n`],
  ]);
  return { sessionId, parentRunId, childRunId, automation };
}

/** Remove every seeded sidecar/transcript (by name prefix) and run dir (by id). */
function cleanupSeeded(): void {
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const d=p.join(process.env.HOME,${JSON.stringify(SESSIONS_REL)});` +
      `if(fs.existsSync(d)){for(const f of fs.readdirSync(d)){` +
      `if(!f.endsWith(".meta.json"))continue;` +
      `try{const m=JSON.parse(fs.readFileSync(p.join(d,f),"utf8"));` +
      `if(typeof m.name==="string"&&m.name.startsWith(${JSON.stringify(PREFIX)})){` +
      `const base=f.slice(0,-".meta.json".length);` +
      `for(const ext of [".meta.json",".jsonl"]){try{fs.unlinkSync(p.join(d,base+ext))}catch{}}}}catch{}}}` +
      `const r=${JSON.stringify(RUNS_ABS)};` +
      `if(fs.existsSync(r)){for(const f of fs.readdirSync(r)){` +
      `if(f.includes(${JSON.stringify(PREFIX)}))fs.rmSync(p.join(r,f),{recursive:true,force:true});}}` +
      `const a=${JSON.stringify(`${FIXTURE_GIT}/.pi/automation`)};` +
      `if(fs.existsSync(a)){for(const f of fs.readdirSync(a)){` +
      `if(f.startsWith(${JSON.stringify(PREFIX)}))fs.rmSync(p.join(a,f),{recursive:true,force:true});}}`,
  );
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(() => undefined);
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

async function archivedIds(page: Page): Promise<Set<string>> {
  const res = await page.request.get(`/api/sessions/archived?cwd=${encodeURIComponent(FIXTURE_GIT)}&limit=200`);
  const body = (await res.json()) as { data?: { items?: Array<{ id: string }> } };
  return new Set((body.data?.items ?? []).map((r) => r.id));
}

async function liveSessionIds(page: Page): Promise<Set<string>> {
  const res = await page.request.get("/api/sessions");
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return new Set((body.data ?? []).map((s) => s.id));
}

/** The folder renders expanded by default; guard against a hidden initial collapse (as `archive-fold.spec.ts`). */
async function ensureFolderExpanded(page: Page): Promise<void> {
  await page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).waitFor({ state: "visible", timeout: 30_000 });
  const body = page.getByTestId(`folder-body-${FIXTURE_GIT}`);
  if ((await body.count()) > 0) return;
  const card = page
    .locator("div")
    .filter({ has: page.getByTestId(`folder-home-row-${FIXTURE_GIT}`) })
    .filter({ has: page.getByTestId("folder-toggle-btn") })
    .last();
  await card.getByTestId("folder-toggle-btn").click();
  await expect.poll(async () => body.count(), { timeout: 5_000 }).toBeGreaterThan(0);
}

async function createShownAutomation(page: Page, name: string): Promise<void> {
  const res = await page.request.post("/api/plugins/automation/create", {
    data: {
      scope: "folder",
      cwd: FIXTURE_GIT,
      name,
      config: {
        on: { kind: "schedule", cron: "0 0 1 1 *" },
        action: { kind: "core.skill", payload: { skill: "$noop-a" } },
        model: "@fast",
        mode: "local",
        sandbox: "workspace-write",
        concurrency: "skip",
        visibility: "shown",
      },
    },
  });
  expect(res.ok(), `create failed: ${res.status()} ${await res.text()}`).toBe(true);
}

test.describe("archive service sessions on end (archive-service-sessions-on-end)", () => {
  test.setTimeout(240_000);

  test.beforeEach(() => cleanupSeeded());
  test.afterEach(() => {
    try {
      cleanupSeeded();
    } catch {
      /* best-effort — the next run's entry cleanup heals */
    }
  });

  test("F1: a declared run session is reclaimed into the folder Archive; the Automation view keeps the run", async ({ page }) => {
    const seeded = seedDeclaredRun();
    await createShownAutomation(page, seeded.automation);
    await restartDashboard();

    await gotoDashboard(page);
    await ensureFolderExpanded(page);
    // Out of the live set, into the folder's archive index — despite being
    // 1 h old (the age rule would keep it 30 d).
    expect((await archivedIds(page)).has(seeded.sessionId)).toBe(true);
    expect((await liveSessionIds(page)).has(seeded.sessionId)).toBe(false);
    await expect(page.locator(`[data-session-id="${seeded.sessionId}"]`)).toHaveCount(0);
    // …and it is listed in the folder's `Archive (N)` fold.
    const toggle = page.getByTestId(`folder-archive-toggle-${FIXTURE_GIT}`);
    await expect(toggle).toContainText(/Archive \(\d+\)/, { timeout: 30_000 });
    await toggle.click();
    await expect(
      page.locator(`[data-testid="archived-session-row"][data-archived-id="${seeded.sessionId}"]`),
    ).toBeVisible({ timeout: 30_000 });

    // The Automation view reads the run store, not the session.
    await page.goto(`/folder/${encodeFolderPath(FIXTURE_GIT)}/automations`);
    await expect(page.getByTestId(`automation-run-${seeded.parentRunId}`)).toBeVisible({ timeout: 30_000 });
  });

  test("F5: the run monitor resolves an archived run and links its read-only transcript", async ({ page }) => {
    const seeded = seedDeclaredRun();
    await restartDashboard();
    await gotoDashboard(page);
    expect((await archivedIds(page)).has(seeded.sessionId)).toBe(true);

    await page.goto(`/folder/${encodeFolderPath(FIXTURE_GIT)}/automations/run/${seeded.sessionId}`);
    const monitor = page.getByTestId("automation-run-monitor");
    await expect(monitor).toBeVisible({ timeout: 30_000 });
    await expect(monitor.getByTestId("run-status")).toHaveText("done", { timeout: 20_000 });
    await expect(monitor.getByTestId("run-result")).toContainText(`${PREFIX} finding`);

    const link = monitor.getByTestId("run-archived-transcript");
    await expect(link).toHaveAttribute("href", `/session/${seeded.sessionId}?archived=1`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/session/${seeded.sessionId}\\?archived=1`), { timeout: 20_000 });
    await expect(page.getByTestId("chat-scroll-container")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`${PREFIX} transcript marker`).first()).toBeVisible({ timeout: 20_000 });
    // Read-only: the composer is never mounted.
    await expect(page.getByTestId("send-button")).toHaveCount(0);
  });
});
