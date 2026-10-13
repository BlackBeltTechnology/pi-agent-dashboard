/**
 * Browser E2E: sessions spawned from the OpenSpec board must NOT steal focus
 * (test-plan #F2, #F3). The user stays on `/folder/<cwd>/openspec` while the
 * new session registers; the placeholder clears and the session shows up on
 * its proposal card.
 *
 * The fixture repo is created per run with a unique name so the folder
 * provably has no prior sessions (the harness container is shared).
 *
 * See change: openspec-board-spawn-no-focus.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

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

const FIXTURE = `/fixtures/board-nofocus-${Date.now().toString(36)}`;
const CHANGE_NAME = "board-nofocus-change";
const BOARD_URL = `/folder/${Buffer.from(FIXTURE).toString("base64url")}/openspec`;

function createBoardRepo(): void {
  sh(
    [
      `mkdir -p ${FIXTURE}/openspec/changes/${CHANGE_NAME}`,
      `printf '# Proposal\\n\\n## Why\\n\\nfixture.\\n' > ${FIXTURE}/openspec/changes/${CHANGE_NAME}/proposal.md`,
      `printf '# Tasks\\n\\n## 1. Fixture\\n\\n- [ ] 1.1 Fixture task.\\n' > ${FIXTURE}/openspec/changes/${CHANGE_NAME}/tasks.md`,
      `cd ${FIXTURE}`,
      "git init -q",
      "git add -A",
      "git -c user.name=pi-test -c user.email=pi-test@localhost commit -q -m 'board no-focus fixture'",
    ].join(" && "),
  );
}

test.afterAll(() => {
  try {
    sh(`rm -rf ${FIXTURE} ${FIXTURE}-*`);
  } catch {
    // teardown is advisory
  }
});

interface SessionRow {
  id: string;
  cwd?: string;
  status?: string;
}

async function liveSessions(page: Page, match: (cwd: string) => boolean): Promise<SessionRow[]> {
  const res = await page.evaluate(async () => (await fetch("/api/sessions")).json());
  const rows = (res?.data?.sessions ?? res?.data ?? []) as SessionRow[];
  return rows.filter((s) => s.cwd && match(s.cwd) && s.status !== "ended");
}

/** Record every URL the page visits so "never navigated" is provable, not sampled. */
function trackUrls(page: Page): string[] {
  const seen: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) seen.push(f.url());
  });
  return seen;
}

async function openFixtureBoard(page: Page): Promise<void> {
  await gotoDashboard(page);
  await pinDirectory(page, FIXTURE);
  await page.goto(BOARD_URL);
  await page.getByTestId("openspec-board").waitFor({ state: "visible", timeout: 30_000 });
  await expect(page.getByTestId(`board-card-${CHANGE_NAME}`)).toBeVisible({ timeout: 60_000 });
}

test.describe("OpenSpec board spawn does not take focus", () => {
  test.beforeAll(() => createBoardRepo());

  test("F2: card + Session stays on the board", async ({ page }) => {
    test.setTimeout(180_000);
    await openFixtureBoard(page);
    const urls = trackUrls(page);

    await page.getByTestId(`card-new-session-${CHANGE_NAME}`).click();
    await expect
      .poll(async () => (await liveSessions(page, (c) => c === FIXTURE)).length, { timeout: 90_000 })
      .toBeGreaterThan(0);
    // The registration is what would have triggered the navigation.
    await expect(page.getByTestId(`board-card-${CHANGE_NAME}`).getByTestId("board-session-row").first())
      .toBeVisible({ timeout: 30_000 });

    expect(page.url()).toContain(BOARD_URL);
    expect(urls.filter((u) => u.includes("/session/"))).toEqual([]);
  });

  test("F3: card New worktree stays on the board", async ({ page }) => {
    test.setTimeout(180_000);
    await openFixtureBoard(page);
    const urls = trackUrls(page);

    await page.getByTestId(`card-new-worktree-${CHANGE_NAME}`).click();
    await page.getByTestId("worktree-dialog-create-submit").click();
    await expect
      .poll(async () => (await liveSessions(page, (c) => c.startsWith(`${FIXTURE}/`) || c.startsWith(`${FIXTURE}-`))).length, {
        timeout: 90_000,
      })
      .toBeGreaterThan(0);

    expect(page.url()).toContain(BOARD_URL);
    expect(urls.filter((u) => u.includes("/session/"))).toEqual([]);
    // Parent-folder spawn placeholder cleared.
    await expect(page.locator(`[data-testid="folder-body-${FIXTURE}"] [data-testid="placeholder-session-card"]`))
      .toHaveCount(0, { timeout: 30_000 });
  });
});
