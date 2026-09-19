/**
 * L3 — automation identity survives a restart: a `visibility:"hidden"` run must
 * stay off the board, and a restored run must keep its plugin slot + badge.
 *
 * Why L3: the defect is a CLIENT/SERVER round-trip that no unit test can prove.
 * The spawn seam merges `kind` + `automationRun` onto the sidecar; the routine
 * debounced save is a FULL overwrite and used to drop both, and the cold-start
 * scan never read `automationRun` back. Only a real boot (`POST /api/restart`
 * over seeded sidecars) exercises that path end-to-end.
 *
 * Exemplar: `tests/e2e/archive-fold.spec.ts` (sidecar seeding out-of-band via
 * `docker exec` + restart) and `tests/e2e/ended-session-endedat.spec.ts`. Port +
 * compose project come from `.pi-test-harness.json` — never hardcoded.
 *
 * SELF-ISOLATION: the harness is ONE container shared by every spec and the
 * fixture repo persists across runs. Every seeded sidecar carries the
 * `e2e-auto-identity` name prefix, and `cleanupSeeded()` deletes them (and their
 * `.jsonl`) by that prefix on every entry and exit — so a crashed run heals on
 * the next one and no run ever sees a leftover row.
 *
 * See change: fix-automation-identity-persistence (test-plan #F1, #F2).
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { expect, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

const PREFIX = "e2e-auto-identity";
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
  )
    .trim()
    .split("\n")[0];
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
 * Run a JS snippet inside the container with `node`. The snippet is base64-
 * staged so it may contain any quotes — hand-escaping JSON into a
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

const SESSIONS_REL = `.pi/agent/sessions/${encodeCwd(FIXTURE_GIT)}`;

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

/**
 * Plant one session pair (`.jsonl` + `.meta.json`) in the fixture folder.
 *
 * The filename MUST carry pi's `<stamp>_<uuid>.jsonl` shape: `session-scanner`
 * derives the session id from it and skips anything else.
 */
function seedSession(opts: {
  name: string;
  startedAt: number;
  endedAt: number;
  kind?: "automation";
  automationRun?: { name: string; runId: string; visibility?: "hidden" | "shown" };
}): string {
  const id = crypto.randomUUID();
  const stamp = new Date(opts.startedAt).toISOString().replace(/:/g, "-").replace(/\./g, "-");
  const fname = `${stamp}_${id}.jsonl`;
  const jsonlRel = `${SESSIONS_REL}/${fname}`;
  writeHomeFile(
    jsonlRel,
    `${JSON.stringify({ type: "session", id, cwd: FIXTURE_GIT, timestamp: new Date(opts.startedAt).toISOString() })}\n`,
  );

  const meta: Record<string, unknown> = {
    cwd: FIXTURE_GIT,
    status: "ended",
    name: opts.name,
    firstMessage: opts.name,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
  };
  if (opts.kind) meta.kind = opts.kind;
  if (opts.automationRun) meta.automationRun = opts.automationRun;
  writeHomeFile(`${SESSIONS_REL}/${fname.replace(/\.jsonl$/, ".meta.json")}`, `${JSON.stringify(meta, null, 2)}\n`);
  return id;
}

/**
 * Delete every seeded sidecar + transcript under the fixture folder.
 *
 * Selector is the SESSION NAME prefix, not a tracked path list: the files a
 * crashed run left behind carry no in-memory record, and the fixed prefix is
 * what makes a re-run self-healing.
 */
function cleanupSeeded(): void {
  runNode(
    `const fs=require("fs"),p=require("path");` +
      `const d=p.join(process.env.HOME,${JSON.stringify(SESSIONS_REL)});` +
      `if(!fs.existsSync(d))process.exit(0);` +
      `for(const f of fs.readdirSync(d)){` +
      `if(!f.endsWith(".meta.json"))continue;` +
      `try{const m=JSON.parse(fs.readFileSync(p.join(d,f),"utf8"));` +
      `if(typeof m.name==="string"&&m.name.startsWith(${JSON.stringify(PREFIX)})){` +
      `const base=f.slice(0,-".meta.json".length);` +
      `for(const ext of [".meta.json",".jsonl"]){try{fs.unlinkSync(p.join(d,base+ext))}catch{}}}}catch{}}`,
  );
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

const card = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`);
/** The board's "show hidden" toggle — a `ToggleButton` labelled `Hidden`. */
const hiddenToggle = (page: Page) => page.getByRole("button", { name: "Hidden", exact: true });

/** Reveal the folder + its ended tier so an ended run/card has somewhere to land. */
async function revealEnded(page: Page): Promise<void> {
  await page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).waitFor({ state: "visible", timeout: 30_000 });
  // The folder renders EXPANDED by default (fresh context, empty
  // `collapsedGroups`) — but guard against a hidden initial collapse. The card
  // root is the innermost DOM node holding BOTH the home row and the toggle;
  // the shared `folderCard` helper keyed on `sortable-*` does not match an
  // unpinned folder group, so mirror `archive-fold.spec.ts`'s local expansion.
  const body = page.getByTestId(`folder-body-${FIXTURE_GIT}`);
  if ((await body.count()) === 0) {
    const card = page
      .locator("div")
      .filter({ has: page.getByTestId(`folder-home-row-${FIXTURE_GIT}`) })
      .filter({ has: page.getByTestId("folder-toggle-btn") })
      .last();
    await card.getByTestId("folder-toggle-btn").click();
    await expect.poll(async () => body.count(), { timeout: 5_000 }).toBeGreaterThan(0);
  }
  const ended = page.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`);
  await ended.waitFor({ state: "visible", timeout: 30_000 });
  // The tier may already be open; its aria-label reads `Hide …` when expanded
  // and `Show …` when collapsed, so only click when it is actually closed.
  const label = (await ended.getAttribute("aria-label")) ?? "";
  if (/^Show /.test(label)) await ended.click();
}

test.describe("automation identity across a restart (fix-automation-identity-persistence)", () => {
  test.setTimeout(240_000);

  test.beforeEach(() => cleanupSeeded());
  test.afterEach(() => {
    try {
      cleanupSeeded();
    } catch {
      /* teardown best-effort — the next run's entry cleanup heals */
    }
  });

  test("F1: a hidden automation run does not resurface after a restart", async ({ page }) => {
    const now = Date.now();
    const user = seedSession({ name: `${PREFIX}-user`, startedAt: now - 4 * HOUR, endedAt: now - 3 * HOUR });
    const run = seedSession({
      name: `${PREFIX}-hidden-run`,
      startedAt: now - 2 * HOUR,
      endedAt: now - 1 * HOUR,
      kind: "automation",
      automationRun: { name: "nightly", runId: "r1", visibility: "hidden" },
    });
    await restartDashboard();

    await gotoDashboard(page);
    await revealEnded(page);

    // The ordinary ended user session gives the folder a live group and is the
    // only thing the board should show.
    await expect(card(page, user)).toBeVisible({ timeout: 30_000 });
    await expect(card(page, run)).toHaveCount(0);

    // The run is REVEALABLE via the same affordance as a user-hidden session.
    await hiddenToggle(page).click();
    await expect(card(page, run)).toBeVisible({ timeout: 20_000 });
  });

  test("F2: restart is invisible to the run surface — slot mounts, badge keeps the run name", async ({ page }) => {
    const now = Date.now();
    const run = seedSession({
      name: `${PREFIX}-shown-run`,
      startedAt: now - 2 * HOUR,
      endedAt: now - 1 * HOUR,
      kind: "automation",
      automationRun: { name: "briefing", runId: "r2", visibility: "shown" },
    });
    await restartDashboard();

    await gotoDashboard(page);
    await revealEnded(page);

    // A shown run stays on the board across the restart …
    await expect(card(page, run)).toBeVisible({ timeout: 30_000 });
    // … and its plugin slot contribution re-arms (predicate reads restored
    // `kind`) with the restored run name (not the fallback label).
    await expect(card(page, run).getByTestId("automation-badge")).toContainText("briefing", { timeout: 20_000 });
  });
});
