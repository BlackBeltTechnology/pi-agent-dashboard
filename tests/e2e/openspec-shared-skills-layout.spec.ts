import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { expandFolder, folderCard, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { closeSessionMenu, openSessionMenu } from "./helpers/session-actions-menu.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Browser E2E — change `fix-openspec-readiness-shared-skills` (#1165).
 *
 * A project whose OpenSpec skills live ONLY under the committed shared layout
 * `.agents/skills/openspec-explore/` (no `.pi/skills/`) must not read as
 * `STALE · missing-skills`. Covers test-plan #F1 (folder pill clears without a
 * server restart), #F2 (session-card controls stay enabled) and #F3 (reverse
 * transition: removing the shared skills brings `skills missing` back — the
 * answer is recomputed per poll, never cached READY).
 *
 * Out-of-band mutations (`docker exec`) converge on the next poll tick; the
 * poll interval is dropped to its 5s clamp for the run and restored after.
 * Helpers are copied from the sibling `openspec-init-affordances-*` specs, the
 * repo convention for self-contained browser specs.
 */

const RUN = Date.now().toString(36);

/** Resolve the harness container by its published dashboard port (never 8000). */
function harnessContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no harness container on port ${DASHBOARD_PORT}`);
  return name;
}

/** Run a shell snippet inside the harness container (out-of-band mutation). */
function dsh(cmd: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", cmd], { encoding: "utf8" });
}

/** Fresh fixture git repo under /fixtures (listable by the pin dialog's PathPicker).
 *  A git repo, like any real project that commits `.agents/skills/`: the readiness
 *  probe answers at the git config root, and a non-git dir without
 *  `.pi/settings.json` has none (null root → skills refused for both layouts). */
function makeDir(name: string): string {
  const dir = `/fixtures/e2e-ssl-${RUN}-${name}`;
  dsh(`rm -rf ${dir} && mkdir -p ${dir} && git init -q ${dir}`);
  return dir;
}

/** Thin same-origin API caller in page context. */
async function api(
  page: Page,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, (i ?? undefined) as RequestInit | undefined);
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    },
    [path, init ? (JSON.parse(JSON.stringify(init)) as RequestInit) : null] as const,
  );
}

function postJson(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } as RequestInit;
}

/** PUT a partial `openspec` config block through the authenticated page context
 *  (a node-side fetch from the host is not loopback to the container → 401). */
async function putOpenspecConfig(page: Page, openspec: Record<string, unknown>): Promise<void> {
  const r = await api(page, "/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openspec }),
  } as RequestInit);
  expect(r.body?.success, JSON.stringify(r.body)).toBe(true);
}

/** The folder section for `cwd`, scoped to its folder card. */
function section(page: Page, cwd: string, variant: "" | "stale"): Locator {
  const testid = variant === "" ? "folder-openspec-section" : `folder-openspec-section-${variant}`;
  return folderCard(page, cwd).getByTestId(testid).first();
}

/** Pin (if needed) and expand `cwd`'s folder card, settling the onboarding→dashboard flip first. */
async function pinAndExpand(page: Page, cwd: string): Promise<Locator> {
  const card = folderCard(page, cwd);
  if ((await card.count()) === 0) {
    const affordance = page.getByTestId("dashboard-add-folder-btn").first().or(page.getByTestId("onboarding-step-2-cta"));
    await expect(affordance.first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    if ((await card.count()) === 0) await pinDirectory(page, cwd);
  }
  await expandFolder(page, cwd);
  return card;
}

/** REST-init a pinned dir (real CLI spawn in-container; writes `.pi/skills`). */
async function initDir(page: Page, cwd: string): Promise<void> {
  const r = await api(page, "/api/openspec/init", postJson({ cwd }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body?.success).toBe(true);
}

/** Pre-trust /fixtures so spawned sessions in initialized cwds skip pi's trust prompt. */
function trustFixtures(): void {
  const current = (() => {
    try {
      return JSON.parse(dsh("cat /home/pi/.pi/agent/trust.json 2>/dev/null")) as Record<string, boolean>;
    } catch {
      return {} as Record<string, boolean>;
    }
  })();
  current["/fixtures"] = true;
  dsh(`echo ${JSON.stringify(JSON.stringify(current))} > /home/pi/.pi/agent/trust.json`);
}

const spawnedSessionIds = new Set<string>();

/** Seed a real session in `dir` (REST spawn), returning its card. Retries once on a spawn flake. */
async function spawnSessionIn(page: Page, dir: string): Promise<Locator> {
  const scoped = folderCard(page, dir).locator('[data-testid="session-card-desktop"]');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const before = new Set(await scoped.evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id"))));
    const r = await api(page, "/api/session/spawn", postJson({ cwd: dir }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body?.success, JSON.stringify(r.body)).toBe(true);
    let freshId: string | null = null;
    const ok = await expect
      .poll(
        async () => {
          const ids = await scoped.evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id")));
          freshId = ids.find((id) => id && !before.has(id)) ?? null;
          return freshId !== null;
        },
        { timeout: 45_000 },
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (ok && freshId) {
      spawnedSessionIds.add(freshId);
      const card = page.locator(
        `[data-testid="session-card-desktop"][data-session-id="${(freshId as string).replace(/"/g, '\\"')}"]`,
      );
      await expect(card).toBeVisible();
      return card;
    }
  }
  throw new Error(`spawn in ${dir} never produced a session card (2 attempts)`);
}

test.describe.configure({ mode: "serial" });

/** Open the dashboard, drop the poll interval to its 5s clamp (out-of-band
 *  mutations converge in one tick) and prime a valid global profile so
 *  `openspec init --tools pi` writes skills. Returns the restore function. */
async function setup(page: Page): Promise<() => Promise<void>> {
  await gotoDashboard(page);
  const cfg = await api(page, "/api/config");
  const o = ((cfg.body?.data as Record<string, Record<string, unknown>>)?.openspec) ?? {};
  const previous = typeof o.pollIntervalSeconds === "number" ? o.pollIntervalSeconds : 60;
  await putOpenspecConfig(page, { pollIntervalSeconds: 5 });
  const prime = await api(page, "/api/openspec/config", postJson({ profile: "core" }));
  expect(prime.status, JSON.stringify(prime.body)).toBe(200);
  trustFixtures();
  return async () => {
    try {
      await putOpenspecConfig(page, { pollIntervalSeconds: previous });
    } catch {
      /* advisory */
    }
  };
}

test.describe("openspec readiness — shared .agents/skills layout (#1165)", () => {
  let restore: (() => Promise<void>) | null = null;

  test.afterEach(async ({ page }) => {
    for (const id of [...spawnedSessionIds]) {
      try {
        await api(page, `/api/session/${id}/shutdown`, { method: "POST" });
      } catch {
        /* advisory */
      }
    }
    spawnedSessionIds.clear();
    await restore?.();
    restore = null;
  });

  test("F1: shared skills created out-of-band clear the `skills missing` pill without a restart", async ({ page }) => {
    test.setTimeout(150_000);
    const dir = makeDir("f1");
    restore = await setup(page);
    const card = await pinAndExpand(page, dir);
    await initDir(page, dir);
    dsh(`rm -rf ${dir}/.pi`);
    const pill = card.getByTestId("folder-openspec-state").first();
    await expect(pill).toHaveText(/skills missing/i, { timeout: 30_000 });

    dsh(`mkdir -p ${dir}/.agents/skills/openspec-explore`);

    // READY renders no state pill at all (only STALE/BROKEN/ABSENT do).
    await expect(section(page, dir, "")).toBeVisible({ timeout: 30_000 });
    await expect(pill).toHaveCount(0);
  });

  test("F2: session-card controls are enabled under the shared layout", async ({ page }) => {
    test.setTimeout(180_000);
    const dir = makeDir("f2");
    restore = await setup(page);
    const card = await pinAndExpand(page, dir);
    await initDir(page, dir);
    dsh(`rm -rf ${dir}/.pi && mkdir -p ${dir}/.agents/skills/openspec-explore`);
    // Section variant proves the poll broadcast this cwd's readiness before the card mounts.
    await expect(section(page, dir, "")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByTestId("folder-openspec-state")).toHaveCount(0);

    const sessionCard = await spawnSessionIn(page, dir);

    await expect(sessionCard.getByTestId("session-openspec-disabled")).toHaveCount(0);
    // READY cards carry their OpenSpec actions in the session menu.
    await openSessionMenu(page, sessionCard);
    await expect(page.getByTestId("session-menu-group-openspec")).toBeVisible();
    await closeSessionMenu(page);
  });

  test("F3: removing the shared skills brings `skills missing` back on the next poll", async ({ page }) => {
    test.setTimeout(150_000);
    const dir = makeDir("f3");
    restore = await setup(page);
    const card = await pinAndExpand(page, dir);
    await initDir(page, dir);
    dsh(`rm -rf ${dir}/.pi && mkdir -p ${dir}/.agents/skills/openspec-explore`);
    const pill = card.getByTestId("folder-openspec-state").first();
    await expect(section(page, dir, "")).toBeVisible({ timeout: 30_000 });
    await expect(pill).toHaveCount(0);

    dsh(`rm -rf ${dir}/.agents`);

    await expect(pill).toHaveText(/skills missing/i, { timeout: 30_000 });
  });
});
