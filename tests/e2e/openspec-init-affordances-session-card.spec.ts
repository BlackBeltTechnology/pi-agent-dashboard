import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import { expandFolder, folderCard, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Browser E2E — SESSION-CARD slice of change `add-openspec-init-affordances`.
 *
 * Covers test-plan #F4–#F11 and #P3 (tasks 2.51–2.58, 2.66): the session
 * card's OPENSPEC subcard readiness gate (ABSENT hides, BROKEN/STALE render
 * the inert disabled panel), the single-control tab order, the two
 * remediation routings (folder section / Settings), reason-text distinctness,
 * the empty-subcard exemption, the legacy-degrade fallback (fixme — see
 * below), and the P3 no-update-status-fetch-from-cards invariant.
 *
 * Session seeding is REST (`POST /api/session/spawn {cwd}`) into fixture
 * directories under /fixtures — a real `pi` process per seed, card arriving
 * over the bridge /ws. Each scenario pins its own dir first and WAITS for the
 * folder section variant (`folder-openspec-section-<variant>`) BEFORE
 * spawning: the section proves the poll has broadcast that cwd's readiness,
 * so the card mounts directly into its final gate state (no transient
 * live-then-disabled flip can make a negative assertion pass vacuously).
 *
 * PRODUCT FINDING (report-only): a dashboard-spawned session in a
 * trust-REQUIRING but untrusted cwd blocks forever on pi's interactive
 * "Trust project folder?" prompt — the tmux spawn cannot answer it, the
 * spawn-register watchdog kills the pane after 30s (`REGISTER_TIMEOUT
 * pid=unknown`, spawn-failures.log), and the user sees a spawn timeout. This
 * hits the PRIMARY flow — initialize OpenSpec on a folder (init materializes
 * `.pi/skills/openspec-*`, which pi lists as trust-requiring), then spawn a
 * session in it. Reproduced 3/3 runs on the f9-profile cwd. The spec works
 * around it by pre-recording `{"/fixtures":true}` in pi's trust store
 * (~/.pi/agent/trust.json — exactly what the prompt's "Trust parent folder"
 * option writes) in beforeAll.
 *
 * Recipes (from the sibling folder spec, empirically verified):
 * - BROKEN · missing-changes-dir: `mkdir -p <dir>/openspec`.
 * - STALE · missing-skills: init, then `rm -rf <dir>/.pi` out-of-band.
 * - STALE · profile-stale: init (records the workflow signature), then
 *   `POST /api/openspec/config { profile: "expanded" }` diverges the global
 *   signature. Missing-skills WINS over profile-stale, so an rm-.pi cwd keeps
 *   its missing-skills reason across a flip. The global profile is snapshotted
 *   and restored after each flip (it is fleet-global).
 *
 * STAGING DEVIATION (F7): the manifest stages "folder group COLLAPSED →
 * activate the card's control". In the real DOM this state cannot exist —
 * SessionList renders the session cards INSIDE the `{!isCollapsed && …}`
 * folder body (SessionList.tsx ~1534), so a collapsed folder group unmounts
 * its cards; the seek handler's expand-guard branch
 * (`collapsedGroups.has(cwd) → handleToggleCollapse`) is defensive-only. The
 * L1 tests (SessionCard.test.tsx) stub the callback; L3 stages the nearest
 * honest variant — folder EXPANDED, control activated — and asserts the
 * observable contract: focus lands on the folder's OpenSpec section, the
 * section is scrolled into view, no dialog opens. See product-bug notes in
 * the change's ship report.
 *
 * P3 deviation: the manifest asks for 40 session cards; each seed is a real
 * `pi` process in the container, so the spec seeds 10 folders × 2 = 20 cards
 * (bounded container cost). The invariant — cards never fetch
 * `/api/openspec/update-status` — is per-card-mount; 20 mounts exercise the
 * same code path as 40. `fetchUpdateStatus` has exactly ONE client caller
 * (OpenSpecProfileSection, the Settings surface) — never mounted on the
 * session-list route this test loads.
 *
 * Config (`openspec.pollIntervalSeconds` / `optOutDirectories`) is snapshotted
 * in beforeAll and restored in afterAll; the poll interval drops to its 5s
 * clamp so out-of-band `docker exec` mutations converge within one tick.
 * See change: add-openspec-init-affordances.
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
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", cmd], {
    encoding: "utf8",
  });
}

/** Create a fresh fixture directory under /fixtures and return its absolute
 *  container path. `prep` is a bare shell command appended after the mkdir
 *  (use DIR as the dir path). */
function makeDir(name: string, prep?: string): string {
  const dir = `/fixtures/e2e-oia-sc-${RUN}-${name}`;
  dsh(`rm -rf ${dir} && mkdir -p ${dir}${prep ? ` && ${prep.replace(/DIR/g, dir)}` : ""}`);
  return dir;
}

/** Thin same-origin API caller in page context (REST setup, DOM asserts). */
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
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as RequestInit;
}

interface OpenSpecSettings {
  pollIntervalSeconds: number;
  optOutDirectories: string[];
}

/** PUT a partial `openspec` config block (server deep-merges; a full array
 *  replaces). Reconfigure applies immediately — no restart. Node-side —
 *  beforeAll/afterAll have no page fixture. */
async function putSettingsNode(partial: Partial<OpenSpecSettings>): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ openspec: partial }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
  if (!body?.success) throw new Error(`config PUT failed: ${JSON.stringify(body)}`);
}

/** The folder section variant for `cwd`, scoped to its folder card. */
function section(page: Page, cwd: string, variant: "" | "absent" | "broken" | "stale"): Locator {
  const testid = variant === "" ? "folder-openspec-section" : `folder-openspec-section-${variant}`;
  return folderCard(page, cwd).getByTestId(testid).first();
}

/** Pin (if needed) and expand `cwd`'s folder card; returns the card.
 *
 *  A fresh page load briefly renders the onboarding (empty) view before the
 *  WS snapshot lands and flips the sidebar to dashboard mode — pinning
 *  mid-flip clicks a CTA that is about to detach. Settle the flip first
 *  (copied verbatim from the sibling folder spec). */
async function pinAndExpand(page: Page, cwd: string): Promise<Locator> {
  const card = folderCard(page, cwd);
  if ((await card.count()) === 0) {
    const affordance = page
      .getByTestId("dashboard-add-folder-btn")
      .first()
      .or(page.getByTestId("onboarding-step-2-cta"));
    await expect(affordance.first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    if ((await card.count()) === 0) await pinDirectory(page, cwd);
  }
  await expandFolder(page, cwd);
  return card;
}

/** REST-init a pinned dir (real CLI spawn in-container). */
async function initDir(page: Page, cwd: string): Promise<void> {
  const r = await api(page, "/api/openspec/init", postJson({ cwd }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body?.success).toBe(true);
}

/** Pre-trust /fixtures for spawned pi sessions (see the PRODUCT FINDING
 *  header note): merge `{"/fixtures":true}` into pi's trust store — the exact
 *  record the "Trust parent folder (/fixtures)" prompt option would write —
 *  so spawned sessions in initialized (trust-requiring) cwds skip the
 *  interactive prompt and register. Idempotent. */
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

/** Snapshot the global OpenSpec workflow profile (restored by the caller
 *  after a divergence flip). */
async function readProfile(page: Page): Promise<{ profile: string; workflows: string[] }> {
  const r = await api(page, "/api/openspec/config");
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const data = (r.body?.data ?? {}) as { profile?: string; workflows?: string[] };
  return { profile: data.profile ?? "custom", workflows: Array.isArray(data.workflows) ? data.workflows : [] };
}

/** Flip the global profile (used to force STALE · profile-stale) and restore
 *  it afterwards — the profile is fleet-global, so every initialized cwd
 *  diverges until the restore.
 *
 *  The restore is SIGNATURE-preserving: it always persists `custom` + the
 *  exact snapshotted workflow list (never the "core" CLI preset, which writes
 *  a preset-defined set that can differ from the snapshot's). The signature
 *  hashes the workflow SET only, so custom+same-set reproduces it exactly. */
async function writeProfile(page: Page, profile: { profile: string; workflows: string[] }): Promise<void> {
  const r = await api(page, "/api/openspec/config", postJson({ profile: profile.profile, workflows: profile.workflows }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body?.success).toBe(true);
}

/** Session ids seeded by THIS spec run — shut down best-effort in
 *  afterEach so each scenario (and each full run) leaves the container's
 *  live-process count flat. Spawned pi processes are real node processes;
 *  without teardown a second run inherits ~10 idle sessions and spawns slow
 *  down until watchdogs fire (observed: `pid=unknown` + 60s card waits). */
const spawnedSessionIds = new Set<string>();

/** Seed a real session whose cwd is `dir` (REST spawn — a real `pi` process
 *  in the container), returning its session card. Scoped to the folder so a
 *  concurrent spawn from an earlier scenario can never be mistaken for this
 *  one.
 *
 *  Retries once: the tmux spawn pipeline occasionally flakes — the POST
 *  returns success but the pi never sends session_register and the watchdog
 *  reclaims it (observed twice on f9-profile, `REGISTER_TIMEOUT pid=unknown`
 *  in spawn-failures.log; three paced manual spawns all register). A retry is
 *  a fresh spawn in the same cwd, not a masked assertion. */
async function spawnSessionIn(page: Page, dir: string): Promise<Locator> {
  const scoped = folderCard(page, dir).locator('[data-testid="session-card-desktop"]');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const before = new Set(await scoped.evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id"))));
    const r = await api(page, "/api/session/spawn", postJson({ cwd: dir }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body?.success, JSON.stringify(r.body)).toBe(true);
    let card: Locator | null = null;
    let freshId: string | null = null;
    const ok = await expect
      .poll(
        async () => {
          const ids = await scoped.evaluateAll((els) => els.map((e) => e.getAttribute("data-session-id")));
          const fresh = ids.find((id) => id && !before.has(id));
          if (fresh) {
            freshId = fresh;
            card = page.locator(
              `[data-testid="session-card-desktop"][data-session-id="${fresh.replace(/"/g, '\\"')}"]`,
            );
            return true;
          }
          return false;
        },
        { timeout: 45_000 },
      )
      .toBe(true)
      .then(() => true)
      .catch(() => false);
    if (ok) {
      if (freshId) spawnedSessionIds.add(freshId);
      await expect(card!).toBeVisible();
      return card!;
    }
    // attempt 1 flaked (watchdog?) — loop retries once with a fresh spawn
  }
  throw new Error(
    `spawn in ${dir} never produced a session card (2 attempts) — ` +
      `check spawn-failures.log for REGISTER_TIMEOUT`,
  );
}

/** The OPENSPEC subcard title element (SessionSubcard renders a bare span
 *  whose text IS the title; i18n fallback "OPENSPEC"). */
function openspecTitle(card: Locator): Locator {
  return card.getByText("OPENSPEC", { exact: true });
}

/** Pin `dir`, expand it, and wait until the poll has broadcast the cwd's
 *  readiness (folder section variant visible) — the precondition that makes
 *  every subsequent card-mount assertion race-free. */
async function pinAndWaitVariant(
  page: Page,
  dir: string,
  variant: "" | "absent" | "broken" | "stale",
): Promise<Locator> {
  const card = await pinAndExpand(page, dir);
  await expect(section(page, dir, variant)).toBeVisible({ timeout: 30_000 });
  return card;
}

/** Live-subcard control testids (SessionOpenSpecActions + its variants).
 *  The disabled contract requires these ABSENT from the card DOM. */
const LIVE_CONTROL_TESTIDS = [
  "session-openspec-actions",
  "explore-btn",
  "explore-unattached-btn",
  "propose-btn",
  "new-change-btn",
  "archive-btn",
  "detach-btn",
  "attach-combo",
  "bulk-archive-btn",
] as const;

test.describe.configure({ mode: "serial" });

let settingsSnapshot: OpenSpecSettings | null = null;

test.describe("openspec init affordances — session card", () => {
  test.beforeAll(async () => {
    // Node-side: snapshot + normalize (sibling pattern). Stale e2e-oia
    // opt-out entries from a crashed earlier run are purged. Poll interval
    // drops to the 5s clamp so out-of-band mutations converge in one tick.
    const res = await fetch(`${BASE_URL}/api/config`);
    const body = (await res.json()) as { data?: { openspec?: Record<string, unknown> } };
    const o = body.data?.openspec ?? {};
    settingsSnapshot = {
      pollIntervalSeconds: typeof o.pollIntervalSeconds === "number" ? o.pollIntervalSeconds : 60,
      optOutDirectories: (Array.isArray(o.optOutDirectories) ? (o.optOutDirectories as string[]) : [])
        .filter((d) => !d.includes("/e2e-oia-")),
    };
    await putSettingsNode({
      pollIntervalSeconds: 5,
      optOutDirectories: settingsSnapshot.optOutDirectories,
    });
    // Prime a VALID global openspec profile (core): `openspec init --tools pi`
    // materializes skills only when the global workflow set resolves to valid
    // templates — with an empty/garbage global profile it silently writes none
    // and every initialized dir lands STALE·missing-skills instead of READY.
    // The harness container may carry an arbitrary global profile from prior
    // runs, so force a known-good one for the whole spec.
    const prime = await fetch(`${BASE_URL}/api/openspec/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: "core" }),
    });
    if (!prime.ok) throw new Error(`profile prime failed: ${prime.status}`);
    // Pre-trust /fixtures so spawns into initialized cwds clear pi's trust
    // prompt (PRODUCT FINDING — see file header).
    trustFixtures();
  });

  test.afterEach(async () => {
    // Best-effort teardown: shut down every session this spec spawned. Runs
    // even after failures (bounded, sequential, errors swallowed — teardown
    // is advisory, never a verdict).
    for (const id of [...spawnedSessionIds]) {
      try {
        await fetch(`${BASE_URL}/api/session/${id}/shutdown`, { method: "POST" });
      } catch {
        /* advisory */
      }
    }
    spawnedSessionIds.clear();
  });

  test.afterAll(async () => {
    // Advisory, never a verdict: restore the harness config. Fixture dirs and
    // sessions are left — the container is disposable.
    const s = settingsSnapshot;
    if (s) {
      try {
        await putSettingsNode({
          pollIntervalSeconds: s.pollIntervalSeconds,
          optOutDirectories: s.optOutDirectories,
        });
      } catch {
        /* advisory */
      }
    }
  });

  test.describe("F4 (#2.51): cwd ABSENT hides the session card's OPENSPEC subcard", () => {
    test("no element titled OPENSPEC within the card", async ({ page }) => {
      test.setTimeout(120_000);
      const dir = makeDir("f4"); // plain dir → readiness ABSENT
      await gotoDashboard(page);
      await pinAndWaitVariant(page, dir, "absent"); // readiness broadcast converged

      const card = await spawnSessionIn(page, dir);

      // Scoped to the card: the subcard title span must not exist, and
      // neither the disabled panel nor the live actions may render.
      await expect(openspecTitle(card)).toHaveCount(0);
      await expect(card.getByTestId("session-openspec-disabled")).toHaveCount(0);
      for (const tid of LIVE_CONTROL_TESTIDS) {
        await expect(card.getByTestId(tid)).toHaveCount(0);
      }
    });
  });

  test.describe("F5 (#2.52): cwd BROKEN renders the disabled panel with no live controls", () => {
    test("OPENSPEC panel present; Explore/Propose/Attach/Archive absent from the card DOM", async ({ page }) => {
      test.setTimeout(120_000);
      const dir = makeDir("f5", "mkdir -p DIR/openspec"); // missing-changes-dir
      await gotoDashboard(page);
      await pinAndWaitVariant(page, dir, "broken");

      const card = await spawnSessionIn(page, dir);

      // Panel + title + non-empty reason line.
      await expect(card.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });
      await expect(openspecTitle(card).first()).toBeVisible();
      const reason = card.getByTestId("session-openspec-disabled-reason");
      await expect(reason).toBeVisible();
      expect(((await reason.textContent()) ?? "").trim().length).toBeGreaterThan(0);

      // The live subcard's whole control set is ABSENT from the card DOM —
      // not dimmed, not disabled: removed.
      for (const tid of LIVE_CONTROL_TESTIDS) {
        await expect(card.getByTestId(tid)).toHaveCount(0);
      }
    });
  });

  test.describe("F6 (#2.53): the disabled panel exposes exactly one focusable element", () => {
    test("tabbing through the panel visits only the remediation control", async ({ page }) => {
      test.setTimeout(120_000);
      const dir = makeDir("f6", "mkdir -p DIR/openspec");
      await gotoDashboard(page);
      await pinAndWaitVariant(page, dir, "broken");

      const card = await spawnSessionIn(page, dir);
      await expect(card.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });

      const remediate = card.getByTestId("session-openspec-remediate");
      await expect(remediate).toBeVisible();

      // Which testid (if any) currently holds focus INSIDE the panel scope?
      const focusInsidePanel = (): Promise<string | null> =>
        page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          if (!a) return null;
          const panel = a.closest('[data-testid="session-openspec-disabled"]');
          return panel ? (a.getAttribute("data-testid") ?? a.tagName) : null;
        });

      // Start ON the control, then Tab (forward) and Shift+Tab (backward)
      // repeatedly. Trusted key events (CDP) drive real focus traversal; any
      // second focusable inside the panel would surface as a distinct stop.
      await remediate.focus();
      expect(await focusInsidePanel()).toBe("session-openspec-remediate");

      const stops = new Set<string>(["session-openspec-remediate"]);
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        const tid = await focusInsidePanel();
        if (tid) stops.add(tid);
      }
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Shift+Tab");
        const tid = await focusInsidePanel();
        if (tid) stops.add(tid);
      }

      // Exactly one focusable element inside the panel: the single control.
      expect(stops.size).toBe(1);
      expect([...stops][0]).toBe("session-openspec-remediate");
    });
  });

  test.describe("F7 (#2.54): missing-changes-dir control routes to the folder OpenSpec section", () => {
    test("activation focuses + scrolls the folder section and opens no dialog", async ({ page }) => {
      test.setTimeout(120_000);
      // STAGING DEVIATION — see the file header. "Folder group COLLAPSED"
      // cannot coexist with a rendered session card (the cards live inside
      // the !isCollapsed folder body), so the control is activated from an
      // EXPANDED folder; the observable contract is asserted unchanged.
      const dir = makeDir("f7", "mkdir -p DIR/openspec");
      await gotoDashboard(page);
      await pinAndWaitVariant(page, dir, "broken");

      const card = await spawnSessionIn(page, dir);
      await expect(card.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });

      await card.getByTestId("session-openspec-remediate").click();

      // Focus moves to the folder's OpenSpec section (raw cwd is the
      // attribute value — compared by value, no selector escaping).
      await expect
        .poll(
          () =>
            page.evaluate((cwd) => {
              const a = document.activeElement as HTMLElement | null;
              return a?.getAttribute("data-folder-openspec-section") === cwd;
            }, dir),
          { timeout: 10_000 },
        )
        .toBe(true);

      // The section is scrolled into view (fully within the viewport).
      const inViewport = await page.evaluate((cwd) => {
        const el = Array.from(document.querySelectorAll("[data-folder-openspec-section]")).find(
          (e) => e.getAttribute("data-folder-openspec-section") === cwd,
        ) as HTMLElement | null;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
      }, dir);
      expect(inViewport).toBe(true);

      // The session card reports readiness and never acts: no dialog opens.
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
  });

  test.describe("F8 (#2.55): profile-stale control routes to Settings", () => {
    // FIXME (product bug — reported, NOT fixed here): readiness can never
    // reach STALE · profile-stale in the real server. The fold (readiness.ts)
    // requires BOTH `recordedSignature` and `currentSignature` defined, but
    // `signatureForTick()` (directory-service.ts) resolves undefined unless
    // `options.currentGlobalSignature` is injected — and the production
    // `createDirectoryService(...)` call (server.ts ~716) passes no such
    // option. The routes layer HAS the provider (update-status/update use it)
    // but never hands it to the directory service, so every readiness-driven
    // surface (folder section, session card) stays READY while
    // /api/openspec/update-status reports needs-update — surfaces disagree.
    // Empirically confirmed this harness: after a core→expanded flip the dir
    // reported needs-update for 30s while folder-openspec-section-stale never
    // appeared. Secondary finding: that dir's init recorded the
    // sha256-of-empty-string signature (`e3b0c442…` in preferences.json), so
    // the init-time CLI read can also fail silently. Un-fixme F8 + F9's
    // third leg once the provider is wired; bodies below are the contract.
    test("activation navigates to the OpenSpec Workflow Profile settings surface", async ({ page }) => {
      test.setTimeout(150_000);
      const dir = makeDir("f8");
      await gotoDashboard(page);
      await pinAndWaitVariant(page, dir, "absent");
      await initDir(page, dir); // records the workflow signature
      await expect(section(page, dir, "")).toBeVisible({ timeout: 30_000 }); // READY

      const profileSnapshot = await readProfile(page);
      try {
        // Diverge the global signature → this cwd converges to STALE ·
        // profile-stale on the next poll tick. STALE renders in the shared
        // `folder-openspec-section-broken` shell; the state TEXT carries the
        // reason discrimination.
        const diverge = profileSnapshot.workflows.join(",") === "explore"
          ? { profile: "custom", workflows: ["explore", "propose"] }
          : { profile: "custom", workflows: ["explore"] };
        await writeProfile(page, diverge);
        // Reload before asserting: the connect snapshot carries readiness
        // (buildOpenSpecConnectSnapshot passes finalized payloads through),
        // making the STALE arrival independent of live-broadcast timing.
        await gotoDashboard(page);
        await pinAndWaitVariant(page, dir, "stale"); // reload collapses groups — re-expand + wait
        await expect(section(page, dir, "stale").getByTestId("folder-openspec-state")).toHaveText(/update/i, {
          timeout: 30_000,
        });

        const card = await spawnSessionIn(page, dir);
        await expect(card.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });
        // The profile-stale reason distinguishes itself ("need an update").
        await expect(card.getByTestId("session-openspec-disabled-reason")).toHaveText(/update/i, {
          timeout: 30_000,
        });

        await card.getByTestId("session-openspec-remediate").click();

        // Navigated to the settings surface that holds the profile section.
        await expect(page).toHaveURL(/\/settings\/openspec/, { timeout: 15_000 });
        await expect(page.getByTestId("openspec-profile-settings")).toBeVisible({ timeout: 15_000 });
      } finally {
        // Fleet-global flip — always restore.
        await writeProfile(page, profileSnapshot);
      }
    });
  });

  test.describe("F9 (#2.56): the three disabled reasons render distinct texts", () => {
    test("the two reachable disabled reasons (BROKEN / STALE·missing-skills) read distinct texts; the READY cwd stays live", async ({ page }) => {
      test.setTimeout(300_000);
      const broken = makeDir("f9-broken", "mkdir -p DIR/openspec");
      const missingSkills = makeDir("f9-skills");
      const profileStale = makeDir("f9-profile");
      await gotoDashboard(page);
      await pinAndWaitVariant(page, broken, "broken");
      await pinAndWaitVariant(page, missingSkills, "absent");
      await pinAndWaitVariant(page, profileStale, "absent");

      await initDir(page, missingSkills);
      await initDir(page, profileStale);
      await expect(section(page, missingSkills, "")).toBeVisible({ timeout: 30_000 });
      await expect(section(page, profileStale, "")).toBeVisible({ timeout: 30_000 });
      // Strip the skills out-of-band → STALE · missing-skills on the next tick.
      dsh(`rm -rf ${missingSkills}/.pi`);
      // STALE renders in its own `folder-openspec-section-stale` shell.
      await expect(section(page, missingSkills, "stale")).toBeVisible({ timeout: 30_000 });

      const brokenCard = await spawnSessionIn(page, broken);
      const skillsCard = await spawnSessionIn(page, missingSkills);
      const profileCard = await spawnSessionIn(page, profileStale);
      await expect(brokenCard.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });
      await expect(skillsCard.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });
      // profileStale is still READY — its card is LIVE (control sanity).
      await expect(profileCard.getByTestId("session-openspec-disabled")).toHaveCount(0);
      await expect(profileCard.getByTestId("explore-unattached-btn").or(profileCard.getByTestId("explore-btn")).first()).toBeVisible();

      const reasonOf = async (card: Locator): Promise<string> => {
        const t = await card.getByTestId("session-openspec-disabled-reason").textContent();
        expect(t, "reason must be non-empty").toBeTruthy();
        return (t ?? "").trim();
      };
      const brokenText = await reasonOf(brokenCard);
      expect(brokenText).toMatch(/not initialized properly/i); // missing-changes-dir copy
      const skillsText = await reasonOf(skillsCard);
      expect(skillsText).toMatch(/skills are missing/i);

      // Distinct non-empty reason texts for the reachable pair. (The third,
      // profile-stale leg is fixme'd below — provider bug, see F8.)
      expect(new Set([brokenText, skillsText]).size).toBe(2);
    });

    // FIXME (product bug — see the F8 describe above): the profile-stale leg
    // cannot converge because readiness never reaches STALE · profile-stale
    // (`currentGlobalSignature` provider never injected into
    // createDirectoryService). Body preserved verbatim as the contract; un-
    // fixme together with F8 once the provider is wired.
    test("a profile flip adds a THIRD distinct reason while missing-skills keeps winning", async ({ page }) => {
      test.setTimeout(180_000);
      const broken = makeDir("f9f-broken", "mkdir -p DIR/openspec");
      const missingSkills = makeDir("f9f-skills");
      const profileStale = makeDir("f9f-profile");
      await gotoDashboard(page);
      await pinAndWaitVariant(page, broken, "broken");
      await pinAndWaitVariant(page, missingSkills, "absent");
      await pinAndWaitVariant(page, profileStale, "absent");

      await initDir(page, missingSkills);
      await initDir(page, profileStale);
      await expect(section(page, missingSkills, "")).toBeVisible({ timeout: 30_000 });
      await expect(section(page, profileStale, "")).toBeVisible({ timeout: 30_000 });
      dsh(`rm -rf ${missingSkills}/.pi`);
      // STALE renders in its own `folder-openspec-section-stale` shell.
      await expect(section(page, missingSkills, "stale")).toBeVisible({ timeout: 30_000 });

      const brokenCard = await spawnSessionIn(page, broken);
      const skillsCard = await spawnSessionIn(page, missingSkills);
      const profileCard = await spawnSessionIn(page, profileStale);
      await expect(brokenCard.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });
      await expect(skillsCard.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });
      await expect(profileCard.getByTestId("session-openspec-disabled")).toHaveCount(0);

      const reasonOf = async (card: Locator): Promise<string> => {
        const t = await card.getByTestId("session-openspec-disabled-reason").textContent();
        expect(t, "reason must be non-empty").toBeTruthy();
        return (t ?? "").trim();
      };
      const brokenText = await reasonOf(brokenCard);
      expect(brokenText).toMatch(/not initialized properly/i);
      const skillsText = await reasonOf(skillsCard);
      expect(skillsText).toMatch(/skills are missing/i);

      const profileSnapshot = await readProfile(page);
      try {
        // Diverge → profileStale flips to STALE · profile-stale; missingSkills
        // KEEPS its missing-skills reason (missing-skills wins).
        const diverge9 = profileSnapshot.workflows.join(",") === "explore"
          ? { profile: "custom", workflows: ["explore", "propose"] }
          : { profile: "custom", workflows: ["explore"] };
        await writeProfile(page, diverge9);
        // Snapshot-driven convergence (see F8 note): reload, re-expand, assert.
        await gotoDashboard(page);
        await pinAndExpand(page, profileStale);
        await expect(profileCard.getByTestId("session-openspec-disabled-reason")).toHaveText(/update/i, {
          timeout: 30_000,
        });

        const profileText = await reasonOf(profileCard);
        const stillSkills = (await skillsCard.getByTestId("session-openspec-disabled-reason").textContent()) ?? "";
        expect(stillSkills.trim()).toBe(skillsText); // win rule held

        // Three DISTINCT non-empty reason strings.
        expect(new Set([brokenText, skillsText, profileText]).size).toBe(3);
      } finally {
        await writeProfile(page, profileSnapshot);
      }
    });
  });

  test.describe("F10 (#2.57): the control-less panel is exempt from the empty-subcard rule", () => {
    test("a panel holding only reason + one control still renders its OPENSPEC title", async ({ page }) => {
      test.setTimeout(120_000);
      const dir = makeDir("f10", "mkdir -p DIR/openspec");
      await gotoDashboard(page);
      await pinAndWaitVariant(page, dir, "broken");

      const card = await spawnSessionIn(page, dir);
      await expect(card.getByTestId("session-openspec-disabled")).toBeVisible({ timeout: 30_000 });

      // Title still renders despite the panel containing only the reason
      // line + the single control.
      await expect(openspecTitle(card).first()).toBeVisible();
      const panel = card.getByTestId("session-openspec-disabled");
      await expect(panel.getByTestId("session-openspec-disabled-reason")).toBeVisible();
      await expect(panel.getByTestId("session-openspec-remediate")).toBeVisible();
      // Exactly one control inside the panel — nothing else snuck in.
      await expect(panel.getByRole("button")).toHaveCount(1);
    });
  });

  test.describe("F11 (#2.58): legacy server (no readiness field) degrades, never disables", () => {
    // L3 has no honest way to hand the client an OpenSpecData payload without
    // `readiness`: the server ALWAYS finalizes + passes readiness through now
    // (connect snapshot fix), and page.route-rewriting the WS snapshot would
    // test a mock, not the product. The legacy-degrade gate is covered at L1
    // in packages/client/src/components/__tests__/SessionCard.test.tsx
    // ("legacy payload (readiness undefined) renders the live subcard exactly
    // as before — never disabled" + the never-disabled assertions).
    test.fixme("payload with no readiness renders per the old hasOpenspecDir || pending gate", async () => {
      // Intentionally empty — see the comment above and the L1 suite.
    });
  });

  test.describe("P3 (#2.66): session cards never fetch /api/openspec/update-status", () => {
    test("page load + 30s idle with a populated fleet: request count is 0", async ({ page }) => {
      test.setTimeout(600_000);
      // 10 pinned folders × 2 real sessions = 20 cards (manifest says 40;
      // deviation documented in the file header — each seed is a real pi
      // process, and the per-card-mount invariant is fully exercised at 20).
      const dirs: string[] = [];
      for (let i = 0; i < 10; i++) dirs.push(makeDir(`p3-${i}`));
      await gotoDashboard(page);
      for (const dir of dirs) await pinAndExpand(page, dir);
      for (const dir of dirs) {
        await spawnSessionIn(page, dir);
        await spawnSessionIn(page, dir);
      }

      // Count from BEFORE the fresh page load through 30s idle.
      let updateStatusCount = 0;
      await page.route("**/api/openspec/update-status", async (route) => {
        updateStatusCount += 1;
        await route.continue();
      });
      try {
        await gotoDashboard(page); // fresh load; route registered first
        await expect
          .poll(
            async () => page.locator('[data-testid="session-card-desktop"]').count(),
            { timeout: 90_000 },
          )
          .toBeGreaterThanOrEqual(20);

        await page.waitForTimeout(30_000); // idle window
        expect(updateStatusCount).toBe(0);
      } finally {
        await page.unroute("**/api/openspec/update-status");
      }
    });
  });
});
