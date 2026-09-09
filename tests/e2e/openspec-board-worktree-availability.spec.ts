/**
 * Browser E2E: the board's per-card `New worktree` action must NOT depend on a
 * live session in the board's cwd (test-plan #F6).
 *
 * The old gate read `sessions.some(s => s.cwd === boardCwd && !!s.gitBranch)`.
 * `gitBranch` only exists once a session in that exact cwd has registered, so
 * a perfectly ordinary git repo whose board you open BEFORE spawning anything
 * (or after its sessions are gone) rendered no worktree button at all — and an
 * absent button is indistinguishable from a render bug.
 *
 * The fixture is created per run with a unique name so the folder provably has
 * ZERO sessions: the harness container is shared, and a leftover session from
 * an earlier run would satisfy the old gate and make this spec vacuous.
 *
 * See change: fix-openspec-board-worktree-button-gating.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/** Resolve the harness container by the dashboard port it publishes. */
function resolveContainer(): string {
  const out = execFileSync("docker", ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"], {
    encoding: "utf8",
  }).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no running container publishes port ${DASHBOARD_PORT}`);
  return name;
}

function sh(script: string): string {
  return execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8" });
}

const FIXTURE = `/fixtures/board-wt-${Date.now().toString(36)}`;
const CHANGE_NAME = "board-wt-change";
const boardUrl = (cwd: string) => `/folder/${Buffer.from(cwd).toString("base64url")}/openspec`;

/**
 * A real git repo holding one OpenSpec change — the minimum a board card
 * needs. The identity is passed per-invocation: the harness image has no
 * global git user, so a bare `git commit` fails on auto-detect.
 */
function createBoardRepo(): void {
  sh(
    [
      `mkdir -p ${FIXTURE}/openspec/changes/${CHANGE_NAME}`,
      `printf '# Proposal\\n\\n## Why\\n\\nfixture.\\n' > ${FIXTURE}/openspec/changes/${CHANGE_NAME}/proposal.md`,
      `printf '# Tasks\\n\\n## 1. Fixture\\n\\n- [ ] 1.1 Fixture task.\\n' > ${FIXTURE}/openspec/changes/${CHANGE_NAME}/tasks.md`,
      `cd ${FIXTURE}`,
      "git init -q",
      "git add -A",
      "git -c user.name=pi-test -c user.email=pi-test@localhost commit -q -m 'board worktree fixture'",
    ].join(" && "),
  );
  // Prove it really is a repo — a silently-failed init would let the helper's
  // fail-open branch, not the folder HEAD, carry the assertions below.
  sh(`git -C ${FIXTURE} rev-parse --abbrev-ref HEAD`);
}

test.afterAll(() => {
  try {
    sh(`rm -rf ${FIXTURE}`);
  } catch {
    // teardown is advisory
  }
});

interface SessionRow {
  id: string;
  cwd?: string;
  status?: string;
}

async function sessionsIn(page: Page, cwd: string): Promise<SessionRow[]> {
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/sessions");
    return r.json();
  });
  const rows = (res?.data?.sessions ?? res?.data ?? []) as SessionRow[];
  return rows.filter((s) => s.cwd === cwd);
}

/** Whether each rendered card worktree action is enabled. */
async function worktreeButtonsEnabled(page: Page): Promise<boolean[]> {
  return page
    .locator('[data-testid^="card-new-worktree-"]')
    .evaluateAll((nodes) => nodes.map((n) => !(n as HTMLButtonElement).disabled));
}

async function openFixtureBoard(page: Page): Promise<void> {
  await page.goto(boardUrl(FIXTURE));
  await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });
  await expect
    .poll(async () => page.locator('[data-testid^="board-card-"]').count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
}

test("board worktree action is available without any session in the board cwd", async ({ page }) => {
  // Spawning + ending a real pi session is well past the default timeout.
  test.setTimeout(180_000);
  createBoardRepo();

  await gotoDashboard(page);
  await pinDirectory(page, FIXTURE);

  // Phase A — ZERO sessions have ever run in this cwd. The old `gitBranch`
  // gate rendered nothing here.
  await openFixtureBoard(page);
  expect(await sessionsIn(page, FIXTURE), "fixture must start session-free").toHaveLength(0);
  const cold = await worktreeButtonsEnabled(page);
  expect(cold.length, "every card renders a worktree action").toBeGreaterThan(0);
  expect(cold.every(Boolean), "worktree action is enabled without a session").toBe(true);

  // Phase B — spawn a session in the folder, end it, and reload: availability
  // must survive the whole `session_removed` round trip.
  await page.goto("/");
  const body = page.locator(`[data-testid="folder-body-${FIXTURE}"]`);
  await expect(body).toBeVisible({ timeout: 30_000 });
  await body.locator('[data-testid="folder-spawn-session-btn"]').first().click();
  await expect
    .poll(async () => (await sessionsIn(page, FIXTURE)).filter((s) => s.status !== "ended").length, { timeout: 90_000 })
    .toBeGreaterThan(0);

  for (const s of (await sessionsIn(page, FIXTURE)).filter((s) => s.status !== "ended")) {
    await page.evaluate(async (id) => {
      await fetch(`/api/session/${id}/shutdown`, { method: "POST" });
    }, s.id);
  }
  await expect
    .poll(async () => (await sessionsIn(page, FIXTURE)).filter((s) => s.status !== "ended").length, { timeout: 90_000 })
    .toBe(0);

  await openFixtureBoard(page);
  const after = await worktreeButtonsEnabled(page);
  expect(after.length, "no card lost its worktree action").toBeGreaterThan(0);
  expect(after.every(Boolean), "worktree action stays enabled after every session ends").toBe(true);
});
