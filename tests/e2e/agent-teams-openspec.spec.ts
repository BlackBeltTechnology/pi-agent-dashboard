import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { listTeamIds, shutdownTeamsCreatedSince, teamViewUrl } from "./helpers/agent-teams.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { gotoDashboard } from "./helpers/index.js";
import { expandMountedToolOutputs } from "./helpers/tool-expand.js";

/**
 * L3 — OpenSpec group / apply teams in the Team view against the docker harness
 * (change: add-agent-teams-openspec; test-plan rows F1, F2, F3; tasks 10.1–10.3).
 *
 * Everything is REAL: a DEDICATED repository is created INSIDE the harness container (`docker exec`, under /tmp: default
 * branch `develop`, committed `.pi/settings.json` without a worktree-init hook, which would fail `init_untrusted`; recorded trusted in
 * pi's `trust.json`; a plain session in it makes it a known folder), the team is started through
 * `POST /api/plugins/agent-teams/teams/start`, and the Team view is read at the lead's `/session/:id/team`.
 *  - A group team's launcher creates a real worktree per change, spawns one faux-model teammate in it and sets the
 *    owner; a teammate "ships" its change when it is prompted with the scripted scenario
 *    `agent-teams-openspec-ship-<taskId>` (qa/fixtures/faux-scenarios.ts: archive the change inside its worktree,
 *    then `TaskUpdate completed`; the server's `not_shipped` gate verifies the repository state).
 *  - F2 uses `ResourceLock` (`agent-teams-openspec-lock-hold` / `-lock-acquire`) of two teammates.
 *  - F3 seeds an APPLY team from a `tasks.md` with hostile checkbox text (the only seed text a repository author
 *    controls freely; group task titles are change names).
 * The repository and its trust entry are removed after each test; shared fixtures are never touched. The port is never hardcoded: the `page` fixture's baseURL (`PW_E2E_PORT`).
 * Harness lifecycle: `docker/test-up.sh -d --build && PW_E2E_USE_RUNNING=1 npm run test:e2e -- agent-teams-openspec`.
 * Skips when the harness does not serve the agent-teams routes.
 */

const API = "/api/plugins/agent-teams";
const GIT = ["git", "-c", "safe.directory=*", "-c", "user.name=e2e", "-c", "user.email=e2e@localhost"];
const LOCK_ACQUIRED_TEXT = "AGENT_TEAMS_OPENSPEC_LOCK_ACQUIRED";

interface Member {
  name: string;
  status: string;
  sessionId?: string;
}
interface Task {
  id: string;
  title: string;
  status: string;
  owner?: string;
  blockedBy: string[];
}
interface Snapshot {
  id: string;
  status: string;
  leadSessionId?: string;
  members: Member[];
  tasks: Task[];
}

// ── container seeding ───────────────────────────────────────────────────────────

/** The dedicated repository of the running test (set by `seedRepo`, one per test; removed by `cleanupRepo`). */
let REPO = "";
const TRUST_FILE = "/home/pi/.pi/agent/trust.json";

/** Run `script` in the container (as the harness user, root); `cwd` defaults to `/`; `input` goes to stdin; `args` are `$1…`. */
function inContainer(script: string, args: string[] = [], input?: string, cwd = "/"): string {
  return execFileSync("docker", ["exec", "-i", "-w", cwd, resolveContainer(), "sh", "-c", script, "sh", ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...(input !== undefined ? { input } : {}),
  }).trim();
}

const writeInRepo = (relPath: string, content: string): void => void inContainer('mkdir -p "$(dirname "$1")" && cat > "$1"', [`${REPO}/${relPath}`], content);
const git = (...args: string[]): string => inContainer('exec "$@"', [...GIT, ...args], undefined, REPO);

/** Set (or, with `null`, drop) pi's recorded trust decision for `dir` (the recorded entry decides project trust first). */
function setTrust(dir: string, value: true | null): void {
  inContainer(
    `node -e 'const fs=require("fs");const [f,d,v]=process.argv.slice(1);let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}if(v==="1")j[d]=true;else delete j[d];fs.writeFileSync(f,JSON.stringify(j,null,2)+"\\n")' "$1" "$2" "$3"`,
    [TRUST_FILE, dir, value ? "1" : "0"],
  );
}

interface SeedChange {
  name: string;
  /** Default: one unticked box. */
  tasks?: string;
  blockedBy?: string[];
}

interface Seeded {
  groupId: string;
  changes: string[];
}

/**
 * Create a DEDICATED git repository in the container (default branch `develop` — the launcher forks worktrees from
 * it — and a committed `.pi/settings.json` without `worktreeInit`), seed `changes`
 * (+ a group that lists them in order, + stand-in ship/review skills), commit, record the folder as trusted, and
 * start a plain session in it: a live session makes the folder a known folder for the REST start admission.
 */
async function seedRepo(page: Page, tag: string, changes: SeedChange[]): Promise<Seeded> {
  REPO = `/tmp/os-e2e-${tag}-${Date.now()}`;
  inContainer('mkdir -p "$1"', [REPO]);
  git("init", "-q", "-b", "develop");
  writeInRepo("README.md", `e2e ${tag}\n`);
  const groupId = `${tag}-group`;
  const names = changes.map((c) => c.name);
  writeInRepo(
    "openspec/groups/groups.json",
    `${JSON.stringify({ schemaVersion: 1, groups: [{ id: groupId, name: groupId }], assignments: Object.fromEntries(names.map((n) => [n, groupId])), changeOrder: { [groupId]: names } }, null, 2)}\n`,
  );
  for (const c of changes) {
    writeInRepo(`openspec/changes/${c.name}/tasks.md`, c.tasks ?? `## 1. Work\n\n- [ ] 1.1 Do ${c.name}\n`);
    writeInRepo(`openspec/changes/${c.name}/proposal.md`, `## Why\n\ne2e change ${c.name}\n`);
    if (c.blockedBy?.length) writeInRepo(`openspec/changes/${c.name}/dependencies.yaml`, `blocked_by:\n${c.blockedBy.map((b) => `  - ${b}\n`).join("")}`);
  }
  // A committed `.pi/settings.json` WITHOUT `worktreeInit`: the dashboard's project auto-seed (project-seed.ts) only
  // writes a stack-detected init hook into a project that has none, and that hook is untrusted ⇒ `init_untrusted`.
  writeInRepo(".pi/settings.json", "{}\n");
  for (const skill of ["ship-it", "review-code"]) {
    writeInRepo(`.pi/skills/${skill}/SKILL.md`, `---\nname: ${skill}\ndescription: e2e stand-in for ${skill} (agent-teams-openspec L3)\n---\n\nStand-in skill; never executed by the scripted faux teammates.\n`);
  }
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", `e2e: seed ${tag}`);
  setTrust(REPO, true);
  const res = await page.request.post("/api/session/spawn", { data: { cwd: REPO } });
  expect(res.ok(), `spawn a session in ${REPO}: ${res.status()} ${await res.text()}`).toBe(true);
  await expect
    .poll(async () => ((await (await page.request.get("/api/sessions")).json()) as { data: Array<{ cwd: string; status: string }> }).data.some((s) => s.cwd === REPO && s.status !== "ended"), {
      timeout: 60_000,
      message: "the folder session registers",
    })
    .toBe(true);
  return { groupId, changes: names };
}

/** Remove the dedicated repository (worktrees live inside it) and its trust entry. */
function cleanupRepo(seeded: Seeded | undefined): void {
  if (!seeded || REPO === "") return;
  inContainer('rm -rf "$1"', [REPO]);
  setTrust(REPO, null);
  REPO = "";
}

// ── REST helpers ────────────────────────────────────────────────────────────────

async function snapshotOf(page: Page, id: string): Promise<Snapshot> {
  const res = await page.request.get(`${API}/teams/${id}`);
  expect(res.ok(), `GET /teams/${id}`).toBe(true);
  return (await res.json()) as Snapshot;
}

async function startTeam(page: Page, template: string, goal: string): Promise<string> {
  const res = await page.request.post(`${API}/teams/start`, { data: { template, goal, cwd: REPO } });
  const body = (await res.json().catch(() => ({}))) as { teamId?: string };
  expect(res.ok() && typeof body.teamId === "string", `POST teams/start ${template} "${goal}" → ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  return body.teamId as string;
}

async function promptSession(page: Page, sessionId: string, text: string): Promise<void> {
  const res = await page.request.post(`/api/session/${sessionId}/prompt`, { data: { text } });
  expect(res.ok(), `prompt ${sessionId}: ${res.status()}`).toBe(true);
}

const taskOfChange = (snap: Snapshot, change: string): Task | undefined => snap.tasks.find((t) => t.title === change);
const memberOf = (snap: Snapshot, name: string | undefined): Member | undefined => snap.members.find((m) => m.name === name);

/** The task's owner member once it has a session and is idle (a prompt during its briefing turn would be refused). */
async function waitIdleOwner(page: Page, teamId: string, change: string): Promise<{ task: Task; member: Member }> {
  let found: { task: Task; member: Member } | undefined;
  await expect
    .poll(
      async () => {
        const snap = await snapshotOf(page, teamId);
        const task = taskOfChange(snap, change);
        const member = memberOf(snap, task?.owner);
        found = task && member?.sessionId && member.status === "idle" ? { task, member } : undefined;
        return found !== undefined;
      },
      { timeout: 240_000, intervals: [1_000], message: `the teammate of change ${change} must be launched and idle` },
    )
    .toBe(true);
  return found as { task: Task; member: Member };
}

/** Prompt the owner of `change` with its scripted ship scenario and wait until the task is completed. */
async function shipChange(page: Page, teamId: string, change: string): Promise<void> {
  const { task, member } = await waitIdleOwner(page, teamId, change);
  await promptSession(page, member.sessionId as string, `[[faux:agent-teams-openspec-ship-${task.id}]] go`);
  await expect
    .poll(async () => taskOfChange(await snapshotOf(page, teamId), change)?.status, { timeout: 240_000, intervals: [1_000], message: `change ${change} must ship (task completed)` })
    .toBe("completed");
}

async function waitSeeded(page: Page, teamId: string, tasks: number): Promise<Snapshot> {
  let snap = await snapshotOf(page, teamId);
  await expect
    .poll(
      async () => {
        snap = await snapshotOf(page, teamId);
        return snap.tasks.length === tasks && snap.leadSessionId !== undefined;
      },
      { timeout: 180_000, intervals: [1_000], message: "the lead must bind and the seed must create the tasks" },
    )
    .toBe(true);
  return snap;
}

/** `{ pid, startedAt }` of the current server process, or null while down. */
async function serverIdentity(page: Page): Promise<string | null> {
  try {
    const res = await page.request.get("/api/health", { timeout: 5_000 });
    if (!res.ok()) return null;
    const body = (await res.json()) as { pid?: number; startedAt?: string };
    return body.pid == null ? null : `${body.pid}:${body.startedAt}`;
  } catch {
    return null; // mid-restart: connection refused / empty response
  }
}

// ── Team view helpers ───────────────────────────────────────────────────────────

interface BoardCard {
  id: string;
  owner: string;
  status: string;
  deps: string[];
}

/** The rendered task board: one entry per card, status from the enclosing section's testid. */
async function boardCards(page: Page): Promise<BoardCard[]> {
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="team-task-card"]')).map((el) => ({
      id: el.getAttribute("data-task") ?? "",
      owner: el.querySelector('[data-testid="team-task-owner"]')?.textContent?.trim() ?? "",
      status: (el.closest("section")?.getAttribute("data-testid") ?? "").replace("team-board-section-", ""),
      deps: Array.from(el.querySelectorAll('[data-testid="team-task-dep"]')).map((d) => d.textContent ?? ""),
    })),
  );
  return cards.sort((a, b) => Number(a.id) - Number(b.id));
}

const depIds = (texts: string[]): string[] =>
  texts
    .map((t) => /#(\d+)/.exec(t)?.[1] ?? "")
    .filter(Boolean)
    .sort();

/** What the board must show for `snap`: ids, status section, `os-…` owner chip, `blockedBy` ids. */
function expectedBoard(snap: Snapshot): BoardCard[] {
  return [...snap.tasks]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((t) => ({ id: t.id, owner: t.owner ?? "", status: t.status, deps: t.blockedBy.map((b) => `#${b}`) }));
}

const normalise = (cards: BoardCard[]): string[] => cards.map((c) => `${c.id}|${c.status}|${/^os-/.test(c.owner) ? c.owner : ""}|${depIds(c.deps).join(",")}`);

/** The view equals the server truth (poll: the view follows the store through a frame or the safety timer). */
async function expectBoardMatchesStore(page: Page, teamId: string, message: string): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(normalise(await boardCards(page))) === JSON.stringify(normalise(expectedBoard(await snapshotOf(page, teamId)))), { timeout: 150_000, intervals: [1_000], message })
    .toBe(true);
}

async function openTeamView(page: Page, snap: Snapshot): Promise<void> {
  await page.goto(teamViewUrl(snap.leadSessionId as string));
  await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 60_000 });
}

/** Widths of the boxes that must not scroll horizontally. */
async function overflowOffenders(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (el.scrollWidth > el.clientWidth) bad.push(`${sel}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    }
    return bad;
  }, selector);
}

test.describe("agent-teams OpenSpec (L3)", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(900_000);

  let before: string[] = [];
  let seeded: Seeded | undefined;

  test.beforeEach(async ({ page }) => {
    const probe = await page.request.get(`${API}/teams`);
    test.skip(probe.status() === 404, "agent-teams plugin routes are not served by this harness");
    await page.setViewportSize({ width: 1280, height: 900 });
    before = await listTeamIds(page);
  });

  test.afterEach(async ({ page }) => {
    await shutdownTeamsCreatedSince(page, before).catch(() => undefined);
    try {
      cleanupRepo(seeded);
    } finally {
      seeded = undefined;
    }
  });

  test("F1 seeded group in the Team view: board = store truth, os-… owner chips, blockedBy, converges after a restart, hashed names do not overflow", async ({ page }) => {
    await gotoDashboard(page);
    const long = "f1-this-change-name-is-quite-long-indeed"; // `os-` + 22 chars + `-` + 6 hex = a 32-char member name
    seeded = await seedRepo(page, "f1", [{ name: "f1-alpha" }, { name: "f1-beta", blockedBy: ["f1-alpha"] }, { name: long }]);

    const listing = (await (await page.request.get(`${API}/templates?cwd=${encodeURIComponent(REPO)}`)).json()) as { templates: Array<{ name: string; source: string }> };
    for (const name of ["openspec-group", "openspec-apply"]) {
      expect(listing.templates.filter((t) => t.name === name && t.source === "bundled"), `bundled template ${name}`).toHaveLength(1);
    }

    const teamId = await startTeam(page, "openspec-group", seeded.groupId);
    let snap = await waitSeeded(page, teamId, 3);
    const alpha = taskOfChange(snap, "f1-alpha") as Task;
    const beta = taskOfChange(snap, "f1-beta") as Task;
    expect(beta.blockedBy, "beta waits for alpha").toEqual([alpha.id]);

    // Parallel 2, order alpha → beta → long: alpha and long launch, beta stays blocked and unowned.
    await expect
      .poll(async () => {
        snap = await snapshotOf(page, teamId);
        return [taskOfChange(snap, "f1-alpha")?.owner, taskOfChange(snap, long)?.owner, taskOfChange(snap, "f1-beta")?.owner];
      }, { timeout: 240_000, intervals: [1_000], message: "alpha and the long-named change launch, beta waits" })
      .toEqual(["os-f1-alpha", expect.stringMatching(/^os-.{29}$/), undefined]);
    const longOwner = taskOfChange(snap, long)?.owner as string;
    expect(longOwner, "hashed member name is exactly 32 characters").toHaveLength(32);

    await openTeamView(page, snap);
    // Members tab (default): the 32-char hashed name must not overflow its card or the table.
    await expect(page.locator(`[data-member="${longOwner}"]`)).toBeVisible({ timeout: 60_000 });
    expect(await overflowOffenders(page, '[data-testid="team-members"], [data-testid="team-member-card"]')).toEqual([]);

    await page.getByRole("tab", { name: /Tasks/ }).click();
    await expect(page.getByTestId("team-board")).toBeVisible();
    await expectBoardMatchesStore(page, teamId, "board matches the store after the launch");
    const first = await boardCards(page);
    expect(first, "board task count == server truth").toHaveLength(snap.tasks.length);
    expect(first.find((c) => c.id === alpha.id)?.owner).toBe("os-f1-alpha");
    expect(first.find((c) => c.id === beta.id)?.owner, "blocked beta is unowned").not.toMatch(/^os-/);
    expect(depIds(first.find((c) => c.id === beta.id)?.deps ?? [])).toEqual([alpha.id]);
    expect(await overflowOffenders(page, '[data-testid="team-board"], [data-testid="team-task-card"]')).toEqual([]);

    // Drive a completion through the API: alpha ships, beta unblocks, launches and gets an os-… owner chip.
    await shipChange(page, teamId, "f1-alpha");
    await expect
      .poll(async () => taskOfChange(await snapshotOf(page, teamId), "f1-beta")?.owner, { timeout: 240_000, intervals: [1_000], message: "beta launches once alpha is completed" })
      .toBe("os-f1-beta");
    await expectBoardMatchesStore(page, teamId, "board matches the store after alpha completed and beta launched");

    // A real server restart mid-run: the view converges to the store's truth (no assertion on how long).
    const identity = await serverIdentity(page);
    expect(identity, "server identity readable before the restart").not.toBeNull();
    await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {
      // The server tears the socket down mid-response: a transport error is the expected shape.
    });
    await expect.poll(async () => {
      const now = await serverIdentity(page);
      return now !== null && now !== identity;
    }, { timeout: 150_000, intervals: [1_000], message: "a different server process must answer" }).toBe(true);
    await page.reload();
    await expect(page.getByTestId("team-view")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("tab", { name: /Tasks/ }).click();
    await expectBoardMatchesStore(page, teamId, "board converges to the store after the restart");
    const after = await snapshotOf(page, teamId);
    expect(after.tasks.map((t) => t.id).sort(), "the restart neither lost nor duplicated a task").toEqual(snap.tasks.map((t) => t.id).sort());
    expect(taskOfChange(after, "f1-alpha")?.status, "alpha stays completed across the restart").toBe("completed");
    expect(after.members.filter((m) => m.name === "os-f1-beta"), "beta's teammate exists once").toHaveLength(1);
  });

  test("F2 ResourceLock: contended acquire renders as a generic tool row; lock_grant is a readable generic log row", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await gotoDashboard(page);
    seeded = await seedRepo(page, "f2", [{ name: "f2-one" }, { name: "f2-two" }]);

    const teamId = await startTeam(page, "openspec-group", seeded.groupId);
    await waitSeeded(page, teamId, 2);
    const one = await waitIdleOwner(page, teamId, "f2-one");
    const two = await waitIdleOwner(page, teamId, "f2-two");
    const sessionOne = one.member.sessionId as string;
    const sessionTwo = two.member.sessionId as string;

    // one takes the lock and keeps its turn busy (the server frees the lock when its holder settles idle).
    await page.goto(`/session/${encodeURIComponent(sessionOne)}`);
    await promptSession(page, sessionOne, "[[faux:agent-teams-openspec-lock-hold]] go");
    await expect
      .poll(async () => {
        await expandMountedToolOutputs(page);
        return /granted\W{0,4}true/i.test(await page.locator("body").innerText());
      }, { timeout: 120_000, intervals: [1_000], message: "one's ResourceLock acquire is granted" })
      .toBe(true);

    // two contends: {granted:false, holder, position:1} must render as an ordinary tool row, no crash.
    await page.goto(`/session/${encodeURIComponent(sessionTwo)}`);
    await promptSession(page, sessionTwo, "[[faux:agent-teams-openspec-lock-acquire]] go");
    await expect(page.getByText(LOCK_ACQUIRED_TEXT).first()).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(async () => {
        await expandMountedToolOutputs(page);
        return (await page.locator("body").innerText()).includes("ResourceLock");
      }, { timeout: 60_000, intervals: [1_000], message: "the ResourceLock tool row is rendered" })
      .toBe(true);
    await expect
      .poll(async () => {
        await expandMountedToolOutputs(page);
        const text = await page.locator("body").innerText();
        return /granted\W{0,4}false/i.test(text) && /position\W{0,4}1/i.test(text);
      }, { timeout: 60_000, intervals: [1_000], message: "the tool row shows the queued answer (granted:false, position)" })
      .toBe(true);
    await expect(page.getByTestId("error-boundary").or(page.getByText(/something went wrong/i))).toHaveCount(0);

    // one's turn settles idle ⇒ the server hands the lock to two with a waking lock_grant mail.
    const snap = await snapshotOf(page, teamId);
    await openTeamView(page, snap);
    await page.getByRole("tab", { name: /Messages/ }).click();
    const row = page.locator('[data-testid="team-mail-row"][data-kind="lock_grant"]');
    await expect(row.first()).toBeVisible({ timeout: 240_000 });
    await expect(row.first().getByTestId("team-mail-kind")).toHaveText(/lock grant/i);
    const text = (await row.first().getByTestId("team-mail-text").innerText()).trim();
    expect(text, "readable sentence, not raw JSON").toMatch(/You now hold the "harness" lock/);
    expect(text).not.toMatch(/^[{[]/);
    expect(pageErrors, "no uncaught page error while rendering the lock rows").toEqual([]);
  });

  test("F3 seed text rendering: unbroken, emoji, bidi, ANSI and HTML task titles render as inert text without overflow", async ({ page }) => {
    await gotoDashboard(page);
    const ESC = String.fromCharCode(27);
    const BIDI = "\u202E";
    const hostile = [
      `## 1. Hostile`,
      ``,
      `- [ ] 1.1 ${"A".repeat(200)}`,
      `- [ ] 1.2 emoji 🚀🔥👩‍👩‍👧‍👦 title`,
      `- [ ] 1.3 rtl ${BIDI}gnp.exe trap`,
      `- [ ] 1.4 ${ESC}[31mred ansi${ESC}[0m text`,
      `- [ ] 1.5 <img src=x onerror="window.__osXss=1"> inject`,
      ``,
    ].join("\n");
    seeded = await seedRepo(page, "f3", [{ name: "f3-hostile", tasks: hostile }]);

    const teamId = await startTeam(page, "openspec-apply", "f3-hostile");
    const snap = await waitSeeded(page, teamId, 6); // five boxes + Review
    expect(snap.tasks.map((t) => t.title).join("\n"), "the server stripped bidi/ANSI controls at the seed").not.toMatch(/[\u202a-\u202e\u2066-\u2069\u001b]/);

    await openTeamView(page, snap);
    await page.getByRole("tab", { name: /Tasks/ }).click();
    const board = page.getByTestId("team-board");
    await expect(board).toBeVisible();
    await expectBoardMatchesStore(page, teamId, "board shows every seeded task");
    expect(await boardCards(page), "board task count == server truth").toHaveLength(snap.tasks.length);

    // No horizontal overflow anywhere on the board or the page.
    expect(await overflowOffenders(page, '[data-testid="team-board"], [data-testid="team-task-card"]')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "page does not scroll horizontally").toBe(true);

    // Text only: no bidi override or ANSI byte in the DOM text, the HTML shows literally and never executes.
    const domText = (await page.getByTestId("team-view").textContent()) ?? "";
    expect(domText).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c\u001b]/);
    expect(domText).toContain("🚀");
    expect(domText).toContain('<img src=x onerror="window.__osXss=1">');
    await expect(board.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __osXss?: unknown }).__osXss), "no injected handler ran").toBeUndefined();
    await expect(page.getByTestId("team-task-card").first()).toBeVisible();
  });
});
