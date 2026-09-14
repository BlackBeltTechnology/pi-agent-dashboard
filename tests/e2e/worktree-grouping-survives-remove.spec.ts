/**
 * Rendered-UI verification that worktree parentage survives the removal race.
 *
 * The user-visible bug: `git worktree remove` run from inside the session's own
 * cwd leaves a residual directory (`node_modules`), the next bridge poll asks
 * `checkoutRoots` afresh, resolves the residual dir as a plain subdirectory of
 * the main repo, and sends `gitWorktree: null`. The server cleared parentage,
 * the ended session's `.meta.json` lost the key, and every restart thereafter
 * rendered a top-level `…/.worktrees/<name>` folder card instead of collapsing
 * under the parent repo.
 *
 * Only a real server + real bridge + real grouped sidebar can prove the fix:
 *   F1  load-time inference heals a persisted record with no parentage
 *   F2  a live session whose worktree is removed underneath keeps parentage,
 *       and the sidebar never gains a `/…/.worktrees/<name>` folder card
 *   X2  a server restart mid-window reattaches without re-opening the clear
 *   X3  the ended session persists the retained parentage to `.meta.json`
 *
 * Harness glue (meta seeding, `/api/restart` + `waitForRestart`, folder-home-row
 * reader) mirrors `submodule-folder-grouping.spec.ts`; worktree create + teardown
 * mirrors `manage-worktrees.spec.ts`.
 *
 * See change: fix-worktree-grouping-lost-on-remove.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { connectBus, expect, type Page, shutdownSession, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard, pinDirectory } from "./helpers/index.js";

interface SessionRow {
  id: string;
  cwd: string;
  status: string;
  sessionFile?: string;
  gitWorktree?: { mainPath: string; name: string };
}

/** The harness container, resolved by the dashboard port it publishes. */
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
 * `/api/restart` tears the listener down, so an in-flight GET raises
 * `socket hang up` rather than returning a status — an unguarded call turns a
 * normal restart into a test failure.
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
 * Wait for the dashboard to be back after `/api/restart`. Requires CONSECUTIVE
 * healthy reads: the outgoing process can still answer for a moment after the
 * restart is accepted, so a single `ok` would match the server about to die.
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

/** Leave onboarding so the sidebar renders folder groups at all. */
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
 * Spawn a session at `cwd` and resolve its id. `POST /api/session/spawn` returns
 * only `{success:true}`, so discover the id by cwd once its bridge registers.
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

/** Thin API caller for JSON POSTs. */
async function apiPost(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ([p, b]) => {
      const res = await fetch(p as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      return { status: res.status, ...(await res.json().catch(() => ({}))) };
    },
    [path, body] as const,
  );
}

/** The fixture's default branch, read off the main entry — never assumed. */
async function baseBranch(page: Page): Promise<string> {
  const res = await page.request.get(`/api/git/worktrees?cwd=${encodeURIComponent(FIXTURE_GIT)}`);
  const data = ((await res.json()) as { data?: { worktrees?: Array<Record<string, unknown>> } }).data;
  const main = (data?.worktrees ?? []).find((e) => (e as { isMain?: boolean }).isMain);
  const branch = (main as { branch?: string | null } | undefined)?.branch;
  if (!branch) throw new Error(`could not resolve the fixture's base branch: ${JSON.stringify(data)}`);
  return branch;
}

test.describe("worktree grouping survives removal", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  const spawned: string[] = [];
  const created = new Set<string>();
  const branches = new Set<string>();
  const token = Date.now().toString(36);
  /** Unique per run so a re-run never collides with a leftover record. */
  const HEAL_ID = `e2e-heal-${token}`;
  const HEAL_CWD = `${FIXTURE_GIT}/.worktrees/${HEAL_ID}`;
  const SEED_DIR = `--e2e-heal-${token}--`;

  /** F2 state, reused by X2/X3. */
  let removalSessionId = "";
  let removalFile = "";

  test.beforeAll(() => {
    const probe = inContainer(`test -d ${FIXTURE_GIT}/.git && echo ok || echo missing`).trim();
    expect(probe, "git fixture missing — rebuild the harness (--build)").toBe("ok");
  });

  test.afterAll(async () => {
    // Sessions first (a leftover live session in a removed worktree would
    // confuse the next run), then the git objects.
    let client: BusClient | undefined;
    try {
      client = await connectBus();
      for (const id of spawned) await shutdownSession(client, id);
    } catch {
      /* best effort — cleanup must never fail the run */
    } finally {
      client?.close();
    }
    const cmds: string[] = [];
    for (const p of created) cmds.push(`git -C ${FIXTURE_GIT} worktree remove --force '${p}' 2>/dev/null || rm -rf '${p}'`);
    for (const b of branches) cmds.push(`git -C ${FIXTURE_GIT} branch -D '${b}' 2>/dev/null || true`);
    cmds.push(`git -C ${FIXTURE_GIT} worktree prune || true`);
    cmds.push(`rm -rf "$HOME/.pi/agent/sessions/${SEED_DIR}"`);
    try {
      inContainer(cmds.join("; "));
    } catch {
      /* best effort */
    }
  });

  // F1 — load-time inference heals a record the removal race left without
  // parentage. Seeded directly: no running bridge can produce the broken shape
  // any more, and a live session would re-stamp it on the next tick.
  test("F1: a persisted record with no parentage heals under the parent repo after restart", async ({ page }) => {
    await enterDashboardMode(page);
    await pinDirectory(page, FIXTURE_GIT);

    const seeded = inContainer(
      `node -e '
        const fs = require("node:fs"), path = require("node:path");
        const [root, id, cwd, dirName] = process.argv.slice(1);
        const dir = path.join(root, dirName);
        fs.mkdirSync(dir, { recursive: true });
        const jsonl = path.join(dir, "2026-03-30T21-39-43-034Z_" + id + ".jsonl");
        fs.writeFileSync(jsonl, JSON.stringify({ type: "session", id, cwd }) + String.fromCharCode(10));
        const st = fs.statSync(jsonl);
        fs.writeFileSync(jsonl.slice(0, -6) + ".meta.json", JSON.stringify({
          id, cwd, source: "tui", startedAt: 1000, status: "ended",
          jsonlMtime: st.mtimeMs, jsonlSize: st.size,
        }));
        console.log(jsonl);
      ' "$HOME/.pi/agent/sessions" ${HEAL_ID} ${HEAL_CWD} ${SEED_DIR}`,
    ).trim();
    expect(seeded, "heal session record was not seeded").not.toBe("");

    await page.request.post("/api/restart", { timeout: 20_000 }).catch(() => undefined);
    await waitForRestart(page);

    // Presence first and separately: a lookup that simply misses would make a
    // bare `gitWorktree` check pass while proving nothing.
    await expect
      .poll(async () => (await listSessions(page)).some((s) => s.id === HEAL_ID), {
        timeout: 60_000,
        message: "seeded session was not restored from persisted metadata",
      })
      .toBe(true);

    const row = (await listSessions(page)).find((s) => s.id === HEAL_ID) as SessionRow;
    expect(row.cwd).toBe(HEAL_CWD);
    expect(row.gitWorktree?.mainPath).toBe(FIXTURE_GIT);
    expect(row.gitWorktree?.name).toBe(HEAL_ID);

    // The healed session groups under the parent repo, so the worktree path is
    // never a top-level folder card.
    await gotoDashboard(page);
    await expect(page.getByTestId(`folder-home-row-${FIXTURE_GIT}`).first()).toBeVisible({ timeout: 60_000 });
    expect(await renderedFolderPaths(page)).not.toContain(HEAL_CWD);
  });

  // F2 — the headline path: a live session whose worktree is removed underneath.
  test("F2: parentage is retained after `git worktree remove` and no folder card appears", async ({ page }) => {
    await enterDashboardMode(page);
    await pinDirectory(page, FIXTURE_GIT);

    // Create a worktree the dashboard way, then spawn a real session inside it.
    const base = await baseBranch(page);
    const branch = `e2e-removal-${token}`;
    const createdRes = await apiPost(page, "/api/git/worktree", { cwd: FIXTURE_GIT, base, newBranch: branch });
    expect(createdRes.success, `create ${branch}: ${JSON.stringify(createdRes)}`).toBe(true);
    const path = createdRes.data?.path as string;
    created.add(path);
    branches.add(branch);

    removalSessionId = await spawnAt(page, path);
    spawned.push(removalSessionId);

    // The bridge reports parentage.
    await expect
      .poll(
        async () => (await listSessions(page)).find((s) => s.id === removalSessionId)?.gitWorktree?.mainPath,
        { timeout: 60_000 },
      )
      .toBe(FIXTURE_GIT);

    // Drive one turn so the transcript exists on disk. A restart can only
    // restore a session the scanner can see, and an idle spawned session has
    // no `.jsonl` yet — without this, X2 would exercise nothing.
    const spawnRow = (await listSessions(page)).find((s) => s.id === removalSessionId) as SessionRow;
    removalFile = spawnRow.sessionFile ?? "";
    expect(removalFile, "spawned session has no transcript path").toBeTruthy();
    const transcriptDir = removalFile.replace(/\/[^/]+\.jsonl$/, "");
    await apiPost(page, `/api/session/${removalSessionId}/prompt`, { text: "e2e worktree removal probe" });
    await expect
      .poll(() => inContainer(`(ls '${transcriptDir}'/*.jsonl >/dev/null 2>&1 && echo yes) || echo no`).trim(), {
        timeout: 60_000,
        message: "session transcript never appeared on disk",
      })
      .toBe("yes");

    // Remove the worktree out-of-band and leave a residual dir, reproducing the
    // exact shape the bug needed: `.git` gone, directory (node_modules) behind.
    inContainer(`git -C ${FIXTURE_GIT} worktree remove --force '${path}' || true`);
    inContainer(`mkdir -p '${path}/node_modules'`);

    // Sample across at least two bridge poll ticks (GIT_POLL_INTERVAL = 30s):
    // parentage must never flap and the sidebar must never gain the worktree
    // path as a top-level folder card.
    const deadline = Date.now() + 65_000;
    let sawRow = false;
    while (Date.now() < deadline) {
      const row = (await listSessions(page)).find((s) => s.id === removalSessionId);
      if (row) {
        sawRow = true;
        expect(row.gitWorktree?.mainPath, "parentage was cleared mid-window").toBe(FIXTURE_GIT);
      }
      expect(await renderedFolderPaths(page), "worktree path leaked into the sidebar").not.toContain(path);
      await page.waitForTimeout(5_000);
    }
    expect(sawRow, "session row disappeared during the removal window").toBe(true);
  });

  // X2 — a restart mid-window: the scanner restores/infers parentage and the
  // same-cwd reattach carries it over, so the reconnect's forced `null`
  // re-send cannot re-open the clear.
  test("X2: parentage survives a server restart mid-window", async ({ page }) => {
    test.skip(!removalSessionId, "F2 did not reach the removal window");

    await page.request.post("/api/restart", { timeout: 20_000 }).catch(() => undefined);
    await waitForRestart(page);

    await expect
      .poll(
        async () => (await listSessions(page)).find((s) => s.id === removalSessionId)?.gitWorktree?.mainPath,
        { timeout: 120_000, message: "parentage lost across restart" },
      )
      .toBe(FIXTURE_GIT);
  });

  // X3 — the retained parentage is what gets persisted when the session ends.
  test("X3: the ended session persists the retained parentage to .meta.json", async ({ page }) => {
    test.skip(!removalSessionId, "F2 did not reach the removal window");

    const sessions = await listSessions(page);
    const row = sessions.find((s) => s.id === removalSessionId) as SessionRow;
    expect(row, "session not present before shutdown").toBeTruthy();
    expect(row.sessionFile, "session file path missing").toBeTruthy();

    let client: BusClient | undefined;
    try {
      client = await connectBus();
      await shutdownSession(client, removalSessionId);
    } finally {
      client?.close();
    }

    const metaFile = `${row.sessionFile!.replace(/\.jsonl$/, "")}.meta.json`;
    await expect
      .poll(
        () => {
          try {
            const meta = JSON.parse(inContainer(`cat '${metaFile}'`)) as SessionRow & { gitWorktree?: { mainPath: string } };
            return meta.gitWorktree?.mainPath ?? "";
          } catch {
            return "";
          }
        },
        { timeout: 60_000, message: "persisted meta never carried the retained parentage" },
      )
      .toBe(FIXTURE_GIT);
  });
});
