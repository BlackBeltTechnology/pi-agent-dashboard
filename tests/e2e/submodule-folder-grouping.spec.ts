/**
 * Rendered-UI verification for the checkout-root resolver.
 *
 * The user-visible bug this change fixes is a FOLDER CARD headed at
 * `…/<super>/.git/modules/<name>` — a directory that does not exist — for a
 * session whose cwd is a git submodule. No unit test can see that: the header
 * is produced by session GROUPING over the bridge's `gitWorktree` payload, and
 * the phantom variant additionally only appears after a server RESTART re-seeds
 * persisted `.meta.json`.
 *
 * Covers test-plan F1–F3. Harness fixtures are built by docker/test-entrypoint.sh:
 *   /fixtures/super/models/sub   submodule checkout (its own .pi/, pre-trusted)
 *   /fixtures/sub-worktree       linked worktree OF that submodule
 *
 * Two harness facts shape the setup and were measured, not assumed:
 *   - the sidebar renders folder groups only in DASHBOARD mode, so a folder
 *     must be pinned first or every assertion times out against onboarding;
 *   - a group derived from session cwd needs a session that is not ended, so
 *     each test spawns its own and asserts while it is live.
 *
 * See change: add-git-checkout-root-resolver.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { connectBus, expect, type Page, shutdownSession, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";

const SUBMODULE = "/fixtures/super/models/sub";
const SUB_WORKTREE = "/fixtures/sub-worktree";
/** What the superseded `dirname(--git-common-dir)` produced for both of them. */
const PHANTOM = "/fixtures/super/.git/modules/models";

interface SessionRow {
  id: string;
  cwd: string;
  status: string;
  gitWorktree?: { mainPath: string; name: string };
}

/** The harness container, resolved by its published dashboard port. */
function containerName(): string {
  const harness = JSON.parse(
    readFileSync(join(process.cwd(), ".pi-test-harness.json"), "utf8"),
  ) as { dashboardPort: number };
  const name = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${harness.dashboardPort}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (!name) throw new Error(`no container publishing port ${harness.dashboardPort}`);
  return name;
}

/** Run a shell command INSIDE the harness container. */
function inContainer(script: string): string {
  return execFileSync("docker", ["exec", containerName(), "sh", "-c", script], { encoding: "utf8" });
}

/** Every folder-group home path currently rendered in the sidebar. */
async function renderedFolderPaths(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="folder-home-row-"]')
    .evaluateAll((els) =>
      els.map((e) => (e.getAttribute("data-testid") ?? "").replace(/^folder-home-row-/, "")),
    );
}

/**
 * Sessions known to the server, or `[]` while it is unreachable.
 *
 * Tolerating the transport error matters: `/api/restart` tears the listener
 * down, so an in-flight GET raises `socket hang up` rather than returning a
 * status — an unguarded call turns a normal restart into a test failure.
 */
async function listSessions(page: Page): Promise<SessionRow[]> {
  try {
    const res = await page.request.get("/api/sessions", { timeout: 15_000 });
    if (!res.ok()) return [];
    return ((await res.json()) as { data?: SessionRow[] }).data ?? [];
  } catch {
    return [];
  }
}

/**
 * Wait for the dashboard to be back after `/api/restart`.
 *
 * Requires CONSECUTIVE healthy reads: the outgoing process can still answer
 * for a moment after the restart is accepted, so a single `ok` would match the
 * server that is about to die and the next call would hang up.
 */
async function waitForRestart(page: Page): Promise<void> {
  let streak = 0;
  await expect
    .poll(
      async () => {
        const ok = await page.request
          .get("/api/health", { timeout: 5_000 })
          .then((r) => r.ok())
          .catch(() => false);
        streak = ok ? streak + 1 : 0;
        return streak;
      },
      { timeout: 180_000, intervals: [1_000], message: "dashboard never came back after /api/restart" },
    )
    .toBeGreaterThanOrEqual(5);
}

/**
 * Leave onboarding so the sidebar renders folder groups at all.
 *
 * Pins the STANDARD fixture, deliberately not the submodule: pinning the
 * submodule would make "a folder card headed at the submodule path" true by
 * construction, and the assertion would no longer test grouping.
 */
async function enterDashboardMode(page: Page): Promise<void> {
  await gotoDashboard(page);
  const pinned = await page
    .locator('[data-testid="sortable-pinned-group"]')
    .first()
    .waitFor({ state: "visible", timeout: 6_000 })
    .then(() => true)
    .catch(() => false);
  if (!pinned) await pinDirectory(page, FIXTURE_GIT);
}

/**
 * Spawn a session at `cwd` and resolve its id.
 *
 * `POST /api/session/spawn` launches pi in tmux and returns only
 * `{success:true}` — no id — so the session must be discovered by cwd once its
 * bridge registers. Resolving by an id NOT present before the spawn keeps the
 * spec isolated in the shared container.
 */
async function spawnAt(page: Page, cwd: string): Promise<string> {
  const before = new Set((await listSessions(page)).map((s) => s.id));
  const res = await page.request.post("/api/session/spawn", { data: { cwd }, timeout: 60_000 });
  expect(res.ok(), `spawn at ${cwd}: ${res.status()}`).toBe(true);

  let id = "";
  await expect
    .poll(
      async () => {
        const fresh = (await listSessions(page)).find((s) => s.cwd === cwd && !before.has(s.id));
        if (fresh) id = fresh.id;
        return Boolean(fresh);
      },
      { timeout: 120_000, message: `no session registered for cwd ${cwd}` },
    )
    .toBe(true);
  return id;
}

test.describe("submodule folder grouping", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  const spawned: string[] = [];
  /** Unique per run so a re-run never collides with a leftover record. */
  const COLD_ID = `e2e-phantom-${Date.now()}`;
  /** POSITIVE CONTROL: same seeding path, but a plausible `mainPath`. Without
   *  it a filter that dropped EVERY persisted record would pass F3. */
  const CONTROL_ID = `e2e-control-${Date.now()}`;

  test.beforeAll(() => {
    // Fail loudly and early if the harness predates the fixture block, rather
    // than letting every assertion time out on a missing folder.
    const probe = inContainer(
      `test -d ${SUBMODULE} && test -d ${SUB_WORKTREE} && echo ok || echo missing`,
    ).trim();
    expect(probe, "submodule fixtures missing — rebuild the harness (--build)").toBe("ok");
  });

  test.afterAll(async () => {
    // The BUS path, not `playwright.request`: a bare `request.newContext()` has
    // no baseURL, so every relative POST rejected and this fallback silently
    // shut down nothing whenever `reapSessions` could not run.
    let client: BusClient | undefined;
    try {
      client = await connectBus();
      for (const id of spawned) await shutdownSession(client, id);
    } catch {
      /* best effort — cleanup must never fail the run */
    } finally {
      client?.close();
    }
    // Specs share one container and the state volume outlives the run.
    try {
      inContainer(`rm -rf "$HOME/.pi/agent/sessions/--e2e-phantom--"`);
    } catch {
      /* best effort */
    }
  });

  // F1 — the headline symptom: a submodule is an independent project and gets
  // its own folder card at its own checkout path, never inside a git dir.
  test("F1: a submodule session groups under its own checkout, never under .git/modules", async ({ page }) => {
    await enterDashboardMode(page);
    spawned.push(await spawnAt(page, SUBMODULE));

    await gotoDashboard(page);
    await expect(page.getByTestId(`folder-home-row-${SUBMODULE}`).first()).toBeVisible({ timeout: 60_000 });

    // No card anywhere in the sidebar is headed inside a git directory.
    await expect
      .poll(async () => (await renderedFolderPaths(page)).filter((p) => p.includes("/.git/")), {
        timeout: 15_000,
      })
      .toEqual([]);
  });

  // F2 — a worktree OF a submodule IS a linked worktree, and its main checkout
  // is the submodule, recovered via repo-local `core.worktree`. The superseded
  // derivation named `<super>/.git/modules/models` here.
  test("F2: a worktree of a submodule groups under the submodule checkout", async ({ page }) => {
    await enterDashboardMode(page);
    const id = await spawnAt(page, SUB_WORKTREE);
    spawned.push(id);

    // The bridge's own verdict for the worktree cwd.
    await expect
      .poll(async () => (await listSessions(page)).find((s) => s.id === id)?.gitWorktree?.mainPath, {
        timeout: 60_000,
      })
      .toBe(SUBMODULE);

    await gotoDashboard(page);
    // It converges under the SUBMODULE's group, and no group is headed at the
    // phantom path.
    await expect(page.getByTestId(`folder-home-row-${SUBMODULE}`).first()).toBeVisible({ timeout: 60_000 });
    expect(await renderedFolderPaths(page)).not.toContain(PHANTOM);
  });

  // F3 — a phantom already ON DISK. It cannot expire on its own: an ended
  // session never re-probes and `.meta.json` is re-seeded at every boot, so
  // only the load-time filter removes it. Seeding a record the current code
  // would never produce is the whole point of this scenario.
  test("F3: a persisted .git/modules phantom renders no folder group after restart", async ({ page }) => {
    await enterDashboardMode(page);

    // The cold record is WRITTEN, not produced by a session: the fix means no
    // running bridge can emit a `.git/modules` mainPath any more, and a live
    // session would re-probe on its next tick and overwrite whatever was
    // seeded — hiding the load-time filter this scenario exists to exercise.
    //
    // The script below goes through `docker exec sh -c`, so it carries no
    // backslash escapes: the shell would consume them before node sees them.
    const seeded = inContainer(
      `node -e '
        const fs = require("node:fs"), path = require("node:path");
        const [root, id, cwd, phantom, plausible, ctlId] = process.argv.slice(1);
        const dir = path.join(root, "--e2e-phantom--");
        fs.mkdirSync(dir, { recursive: true });
        const write = (sid, mainPath) => {
          const jsonl = path.join(dir, "2026-03-30T21-39-43-034Z_" + sid + ".jsonl");
          fs.writeFileSync(jsonl, JSON.stringify({ type: "session", id: sid, cwd }) + String.fromCharCode(10));
          const st = fs.statSync(jsonl);
          fs.writeFileSync(jsonl.slice(0, -6) + ".meta.json", JSON.stringify({
            id: sid, cwd, source: "tui", startedAt: 1000, status: "ended",
            jsonlMtime: st.mtimeMs, jsonlSize: st.size,
            gitWorktree: { mainPath, name: "sub" },
          }));
          return jsonl;
        };
        console.log(write(id, phantom));
        console.log(write(ctlId, plausible));
      ' "$HOME/.pi/agent/sessions" ${COLD_ID} ${SUBMODULE} ${PHANTOM} ${SUBMODULE} ${CONTROL_ID}`,
    ).trim();
    expect(seeded, "phantom session record was not seeded").not.toBe("");
    const cold = COLD_ID;

    await page.request.post("/api/restart", { timeout: 20_000 }).catch(() => undefined);
    await waitForRestart(page);

    // The scanner dropped the phantom while re-seeding persisted metadata, so
    // the cold session degrades to grouping by its own cwd.
    //
    // Presence is asserted FIRST and separately: a restored-session lookup that
    // simply misses would make a bare "gitWorktree is absent" check pass while
    // proving nothing.
    await expect
      .poll(async () => (await listSessions(page)).some((s) => s.id === cold), {
        timeout: 60_000,
        message: "cold session was not restored from persisted metadata",
      })
      .toBe(true);
    const after = await listSessions(page);
    const restored = after.find((s) => s.id === cold) as SessionRow;
    expect(restored.cwd).toBe(SUBMODULE);
    expect(restored.gitWorktree).toBeUndefined();

    // Positive control: a record seeded identically but with a PLAUSIBLE
    // mainPath survives the same load, so the assertion above measures the
    // predicate and not a blanket drop.
    const control = after.find((s) => s.id === CONTROL_ID) as SessionRow;
    expect(control, "control record was not restored").toBeTruthy();
    expect(control.gitWorktree?.mainPath).toBe(SUBMODULE);

    // A live session makes the submodule's group render, so the sidebar can be
    // asserted on: the group is headed at the checkout, and nothing is headed
    // at the phantom.
    spawned.push(await spawnAt(page, SUBMODULE));
    await gotoDashboard(page);
    await expect(page.getByTestId(`folder-home-row-${SUBMODULE}`).first()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => (await renderedFolderPaths(page)).filter((p) => p.includes("/.git/")), {
        timeout: 15_000,
      })
      .toEqual([]);
  });
});
