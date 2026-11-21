import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { connectBus, expect, shutdownSession, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory, TESTIDS } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

/**
 * L3 — a dashboard-spawned session loads a project SKILL only when the dashboard trusts the folder
 * (change: harden-agent-tool-guards D3; test-plan R5 / R15; T.107).
 *
 * Before D3 the bridge answered pi's `project_trust` "yes" for every dashboard spawn, so a project's
 * `.pi/skills/*` (and extensions) loaded in any folder a spawn reached. Now the dashboard's own trust
 * decides: unpinned = pi's `defaultProjectTrust` (the harness's `ask` skips project resources), pinned =
 * trusted, unpinned again = withdrawn. The real-pi half is pinned by `pi-headless-trust-outcome.test.ts`
 * and the pin/unpin loop with a marker extension by `qa/tests/58-spawn-no-auto-trust.sh`; this spec is the
 * only one that reads the loaded SKILL LIST of a real dashboard session.
 *
 * Flow (one fixture clone with `.pi/skills/s/SKILL.md`, one session at a time):
 *   1. unpinned, REST spawn   -> the session registers; the skill is NOT `active`
 *   2. pin through the UI, spawn through the folder's own spawn button -> the skill IS `active`
 *   3. unpin, REST spawn      -> the session registers; the skill is NOT `active`
 * "Registers" is part of every leg: a session blocked on the no-UI trust prompt never reports, so a stall
 * fails the leg (the "no stall" half of R5).
 *
 * HOW THE SKILL LIST IS READ: `GET /api/pi-resources?cwd=` joins the folder's scan with the `commands_list`
 * the live session reported (`status: active | not-loaded`) and names the session behind the join in
 * `contributingSession`. The join needs EXACTLY one live session in the folder, so each session is shut
 * down before the next leg. Asserting `status !== "active"` (not `=== "not-loaded"`) keeps the unpinned
 * legs independent of whether the scan lists a skill pi did not load; `contributingSession` proves the
 * join really ran, so a missing status cannot pass vacuously.
 *
 * Authored WITHOUT a runnable docker harness: first run happens in CI (browser E2E shards).
 */

const TOKEN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const CWD = `/fixtures/spawn-skill-trust-${TOKEN}`;
const SKILL_DIR = `${CWD}/.pi/skills/s`;

function container(): string {
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
    encoding: "utf8",
    timeout: 30_000,
  })
    .trim()
    .split("\n")[0];
  if (!id) throw new Error("no running harness container");
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", container(), "sh", "-c", script], { encoding: "utf8", timeout: 90_000 }).trim();
}

/** Keys the dashboard trust snapshot (what the spawned bridge decides from) currently covers. */
function snapshotKeys(): string[] {
  const raw = inContainer('cat "$HOME/.pi/dashboard/pi-trust-mirror.json" 2>/dev/null || echo "{}"');
  return ((JSON.parse(raw) as { entries?: Array<{ key: string }> }).entries ?? []).map((e) => e.key);
}

interface SkillView {
  /** Session behind the join (exactly one live session in the folder), if any. */
  sessionId?: string;
  /** Status of this fixture's skill, `undefined` when the scan does not list it. */
  status?: string;
  /** Raw payload tail for failure messages. */
  raw: string;
}

async function readSkill(page: Page): Promise<SkillView> {
  const res = await page.request.get(`/api/pi-resources?cwd=${encodeURIComponent(CWD)}&refresh=true`);
  const body = (await res.json().catch(() => ({}))) as {
    data?: {
      local?: { skills?: Array<{ filePath: string; status?: string }> };
      packages?: Array<{ resources?: { skills?: Array<{ filePath: string; status?: string }> } }>;
      contributingSession?: { sessionId: string };
      scanOnly?: boolean;
    };
  };
  const skills = [
    ...(body.data?.local?.skills ?? []),
    ...(body.data?.packages ?? []).flatMap((p) => p.resources?.skills ?? []),
  ];
  const mine = skills.find((s) => s.filePath.includes(`spawn-skill-trust-${TOKEN}/.pi/skills/s/`));
  return {
    sessionId: body.data?.contributingSession?.sessionId,
    status: mine?.status,
    raw: JSON.stringify({ http: res.status(), scanOnly: body.data?.scanOnly, skills: skills.map((s) => [s.filePath, s.status]) }).slice(0, 600),
  };
}

/** Wait until the folder's ONE live session has reported its commands; return what it loaded. */
async function sessionSkill(page: Page, leg: string): Promise<Required<Pick<SkillView, "sessionId">> & SkillView> {
  let last: SkillView = { raw: "(never read)" };
  await expect
    .poll(
      async () => {
        last = await readSkill(page);
        return last.sessionId ?? "";
      },
      { timeout: 120_000, intervals: [2_000], message: `${leg}: the session never registered and reported its commands (a stall on the trust prompt?)` },
    )
    .not.toBe("");
  return last as Required<Pick<SkillView, "sessionId">> & SkillView;
}

async function endSession(sessionId: string): Promise<void> {
  const bus = await connectBus();
  try {
    await shutdownSession(bus, sessionId);
  } finally {
    bus.close();
  }
}

async function restSpawn(page: Page): Promise<void> {
  const res = await page.request.post("/api/session/spawn", { data: { cwd: CWD } });
  expect(res.ok(), `spawn ${CWD}: HTTP ${res.status()} ${await res.text().catch(() => "")}`).toBe(true);
}

test.describe("spawned session skill follows dashboard trust (L3)", () => {
  test.beforeAll(() => {
    inContainer(
      [
        `mkdir -p '${SKILL_DIR}'`,
        `(cd '${CWD}' && { [ -d .git ] || git init -q; })`,
        `printf '%s\\n' '---' 'name: s' 'description: e2e skill that only a trusted project may load' '---' 'Say hi.' > '${SKILL_DIR}/SKILL.md'`,
      ].join(" && "),
    );
  });

  test.afterAll(() => {
    inContainer(`rm -rf '${CWD}'`);
  });

  test("#F13 skill absent unpinned, present once pinned, absent again after unpin; the session registers every time", async ({ page }) => {
    test.setTimeout(420_000);
    await gotoDashboard(page);
    // A clean start: nothing from an earlier run may cover the fixture.
    await page.request.delete("/api/access/pinned-directory", { data: { subject: CWD } }).catch(() => undefined);
    await expect.poll(snapshotKeys, { timeout: 30_000 }).not.toContain(CWD);

    // 1. unpinned
    await restSpawn(page);
    const unpinned = await sessionSkill(page, "unpinned");
    expect(unpinned.status, `unpinned: the project skill must not be loaded (${unpinned.raw})`).not.toBe("active");
    await endSession(unpinned.sessionId);

    // 2. pinned, spawned from the UI
    await pinDirectory(page, CWD);
    await expect.poll(snapshotKeys, { timeout: 30_000 }).toContain(CWD);
    const body = page.getByTestId(`folder-body-${CWD}`);
    await expect(body).toBeVisible({ timeout: 30_000 });
    await body.getByTestId(TESTIDS.folderSpawnSessionBtn).click();
    const pinned = await sessionSkill(page, "pinned");
    expect(pinned.sessionId, "a new session, not the ended one").not.toBe(unpinned.sessionId);
    expect(pinned.status, `pinned: the project skill must be loaded (${pinned.raw})`).toBe("active");
    await endSession(pinned.sessionId);

    // 3. unpinned again
    await page.request.delete("/api/access/pinned-directory", { data: { subject: CWD } });
    await expect.poll(snapshotKeys, { timeout: 30_000 }).not.toContain(CWD);
    await restSpawn(page);
    const again = await sessionSkill(page, "unpinned again");
    expect(again.sessionId, "a new session, not the ended one").not.toBe(pinned.sessionId);
    expect(again.status, `unpinned again: trust was withdrawn, the skill must not be loaded (${again.raw})`).not.toBe("active");
    await endSession(again.sessionId);
  });
});
