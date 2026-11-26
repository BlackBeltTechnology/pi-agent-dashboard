import { expect, type Locator, type Page, test } from "./fixtures.js";
import { ensureGitSession, expandFolder, FIXTURE_GIT, folderCard, gotoDashboard } from "./helpers/index.js";

/**
 * Browser E2E — the "Start team" dialog opened from a workspace folder
 * (change: add-agent-teams-templates-hooks, tasks 15.2 / 15.4 / 15.5 / 15.6;
 * test-plan #S15, #F1, #F2, #F3). Exemplars: folder-actions-menu.spec.ts (the folder
 * menu entry) and access-grant-dialog.spec.ts (dialog states, request-body asserts).
 *
 * The folder entry is a folder-actions-menu item (`folder-menu-item-agent-teams-start`).
 * #F1 starts a REAL team with a bundled template of the harness (listing augmented with
 * one invalid and one untrusted fixture template; the POST goes to the real server) and
 * converges on the session API. The hook-confirmation, double-submit and error cases drive
 * the dialog against a scriptable in-page stand-in for the start route (`page.route`), the
 * same pattern as `helpers/agent-teams.ts`, because the harness has no template with hooks.
 * The server-side start/trust contract is covered by the plugin's L1/L2 suites.
 * STATUS: written, not yet run (needs the docker harness).
 */
test.setTimeout(150_000);

const CWD = FIXTURE_GIT;
const TEAMS = "/api/plugins/agent-teams";
const HOOK_COMMAND = `<img src=x onerror=alert(1)>; echo "&amp;"`;
const GOAL_WITH_MARKUP = "# Heading\n**bold** <script>window.__pwned = 1</script> [link](javascript:alert(1))";

interface FixtureTemplate {
  name: string;
  source: "user" | "project" | "bundled";
  trusted: boolean;
  valid: boolean;
  errors: Array<{ code: string; message?: string }>;
  warnings: Array<{ code: string; message?: string }>;
  hasHooks?: boolean;
  description?: string;
}
const fixtureTemplate = (name: string, over: Partial<FixtureTemplate> = {}): FixtureTemplate => ({ name, source: "user", trusted: true, valid: true, errors: [], warnings: [], ...over });

/** One answer of the stand-in start route. */
interface StartReply {
  status: number;
  body: unknown;
  delayMs?: number;
}
/** Decides the answer of the n-th start POST (1-based) from its parsed body. */
type StartHandler = (n: number, body: Record<string, unknown>) => StartReply;
interface StartStub {
  /** Parsed JSON bodies of every `POST /teams/start`, in order. */
  posts: Array<Record<string, unknown>>;
  /** `cwd` query values of every template listing. */
  listings: string[];
}

/** A fixed answer per attempt; the last one repeats. */
const replies =
  (...list: StartReply[]): StartHandler =>
  (n) =>
    list[Math.min(n, list.length) - 1] ?? { status: 500, body: { error: "internal_error" } };

function triggerOf(page: Page): Locator {
  return page.getByTestId(`folder-actions-menu-${CWD}`).first();
}

async function openStartDialog(page: Page): Promise<Locator> {
  await ensureGitSession(page);
  await expandFolder(page, CWD);
  await triggerOf(page).click();
  await expect(page.getByTestId(`folder-actions-menu-panel-${CWD}`).first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("folder-menu-item-agent-teams-start").click();
  const dialog = page.getByTestId("start-team-dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/** Serve the template listing (a fixture, or the real one with fixtures appended) and the start route. */
async function stubStart(page: Page, opts: { templates?: FixtureTemplate[]; appendToReal?: FixtureTemplate[]; start?: StartHandler }): Promise<StartStub> {
  const stub: StartStub = { posts: [], listings: [] };
  await page.route(/\/api\/plugins\/agent-teams\/templates/, async (route) => {
    stub.listings.push(new URL(route.request().url()).searchParams.get("cwd") ?? "");
    if (opts.templates) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ templates: opts.templates, warnings: [] }) });
    const real = await route.fetch();
    const body = (await real.json()) as { templates?: unknown[]; warnings?: unknown[] };
    await route.fulfill({ response: real, json: { ...body, templates: [...(body.templates ?? []), ...(opts.appendToReal ?? [])] } });
  });
  if (opts.start) {
    const handler = opts.start;
    await page.route(/\/api\/plugins\/agent-teams\/teams\/start$/, async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const reply = handler(stub.posts.push(body), body);
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      await route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
    });
  }
  return stub;
}

const hooksUntrusted = (hash: string, commands: Array<{ event: string; command: string; timeoutMs?: number }>) => ({ status: 409, body: { ok: false, error: "hooks_untrusted", details: { hash, commands } } });

async function chooseAndStart(dialog: Locator, template: string, goal = "review the diff"): Promise<void> {
  await dialog.getByTestId(`start-template-${template}`).check();
  await dialog.getByTestId("start-goal").fill(goal);
  await dialog.getByTestId("start-submit").click();
}

test.describe("Start team dialog", () => {
  test("#F1 folder entry → start: cwd is the folder, invalid / untrusted are disabled, the lead session appears", async ({ page }) => {
    const probe = await page.request.get(`${TEAMS}/templates?cwd=${encodeURIComponent(CWD)}`);
    test.skip(probe.status() === 404, "agent-teams templates route is not served by this harness");
    const real = ((await probe.json()) as { templates?: FixtureTemplate[] }).templates ?? [];
    const startable = real.find((t) => t.valid && t.trusted && !t.hasHooks);
    test.skip(!startable, "the harness has no startable template without hooks");
    const stub = await stubStart(page, {
      appendToReal: [fixtureTemplate("e2e-broken", { valid: false, errors: [{ code: "field_invalid", message: "lead.model is not a string" }] }), fixtureTemplate("e2e-untrusted", { source: "project", trusted: false })],
    });
    const startBodies: Array<Record<string, unknown>> = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/api\/plugins\/agent-teams\/teams\/start$/.test(req.url())) startBodies.push(req.postDataJSON() as Record<string, unknown>);
    });
    const sessionsBefore = await page.evaluate(async () => ((await (await fetch("/api/sessions")).json()) as { data?: Array<{ id: string }> }).data?.map((s) => s.id) ?? []);

    const dialog = await openStartDialog(page);
    expect(stub.listings).toContain(CWD);

    // Invalid / untrusted: disabled, with an accessible reason.
    for (const [name, reason] of [
      ["e2e-broken", /Invalid template/],
      ["e2e-untrusted", /Untrusted project/],
    ] as const) {
      const radio = dialog.getByTestId(`start-template-${name}`);
      await expect(radio).toBeDisabled();
      await expect(radio).toHaveAccessibleDescription(reason);
    }

    await chooseAndStart(dialog, startable?.name ?? "");
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    expect(startBodies).toHaveLength(1);
    expect(startBodies[0]).toMatchObject({ template: startable?.name, cwd: CWD });

    // Converges on session API truth: a new lead session exists for this folder (not a timeout guess).
    await expect
      .poll(
        async () =>
          page.evaluate(
            async ({ before, cwd }) => {
              const body = (await (await fetch("/api/sessions")).json()) as { data?: Array<{ id: string; cwd?: string }> };
              return (body.data ?? []).filter((s) => s.cwd === cwd && !before.includes(s.id)).length;
            },
            { before: sessionsBefore, cwd: CWD },
          ),
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
    await expect(folderCard(page, CWD).locator('[data-testid="session-card-desktop"]').first()).toBeVisible();
  });

  test("#S15 hook commands and the goal render as literal text; no script runs, no Trusted-Types violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /trusted.?types|content security policy/i.test(m.text())) violations.push(m.text());
    });
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await stubStart(page, {
      templates: [fixtureTemplate("hooked", { hasHooks: true })],
      start: replies(hooksUntrusted("h-xss", [{ event: "TaskCompleted", command: HOOK_COMMAND, timeoutMs: 5000 }])),
    });

    const dialog = await openStartDialog(page);
    await chooseAndStart(dialog, "hooked", GOAL_WITH_MARKUP);
    const step = dialog.getByTestId("start-hooks-step");
    await expect(step).toBeVisible({ timeout: 15_000 });

    const command = step.getByTestId("start-hook-command");
    await expect(command).toHaveCount(1);
    expect(await command.evaluate((el) => el.textContent)).toBe(HOOK_COMMAND);
    expect(await command.evaluate((el) => el.children.length), "no element was built from the command").toBe(0);
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs, "no alert() ran").toEqual([]);
    expect(violations, "no Trusted-Types / CSP violation").toEqual([]);
  });

  test("#F2 hook confirmation: exact commands, Confirm retries with the shown hash, Cancel sends nothing, edited hooks → hash_mismatch, trust persists", async ({ page }) => {
    const commands = [
      { event: "TeammateIdle", command: "npm test", timeoutMs: 30_000 },
      { event: "TaskCompleted", command: "make lint" },
    ];
    // A stand-in of the server's per-hash trust: `current` is the hash of the template's hooks (edit it to
    // simulate a changed file), `trusted` the hash the user confirmed.
    const trust = { current: "h1", trusted: undefined as string | undefined };
    const stub = await stubStart(page, {
      templates: [fixtureTemplate("hooked", { hasHooks: true })],
      start: (_n, body) => {
        if (body.trustHooks === undefined) return trust.trusted === trust.current ? { status: 200, body: { teamId: "t_e2e" } } : hooksUntrusted(trust.current, commands);
        if (body.trustHooks !== trust.current) return { status: 409, body: { ok: false, error: "hash_mismatch" } };
        trust.trusted = trust.current;
        return { status: 200, body: { teamId: "t_e2e" } };
      },
    });

    // Start → the step lists the exact commands and the hash; Cancel sends nothing more.
    let dialog = await openStartDialog(page);
    await chooseAndStart(dialog, "hooked");
    await expect(dialog.getByTestId("start-hooks-step").getByTestId("start-hook-command")).toHaveText(["npm test", "make lint"]);
    await expect(dialog.getByTestId("start-hooks-fingerprint")).toContainText("h1");
    await dialog.getByTestId("start-hooks-deny").click();
    await expect(dialog.getByTestId("start-form")).toBeVisible();
    expect(stub.posts, "Cancel sends nothing").toHaveLength(1);
    expect(stub.posts[0]).not.toHaveProperty("trustHooks");

    // Start again → the step; Confirm retries with exactly the shown hash and the dialog closes.
    await dialog.getByTestId("start-submit").click();
    await dialog.getByTestId("start-hooks-allow").click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    expect(stub.posts).toHaveLength(3);
    expect(stub.posts[2]).toMatchObject({ template: "hooked", cwd: CWD, trustHooks: "h1" });

    // The confirmation persists: a second start shows no step and sends no trustHooks.
    dialog = await openStartDialog(page);
    await chooseAndStart(dialog, "hooked");
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    expect(stub.posts).toHaveLength(4);
    expect(stub.posts[3]).not.toHaveProperty("trustHooks");

    // The template is edited → a new hash is shown; edited AGAIN between show and confirm → hash_mismatch, no team.
    trust.current = "h2";
    dialog = await openStartDialog(page);
    await chooseAndStart(dialog, "hooked");
    await expect(dialog.getByTestId("start-hooks-fingerprint")).toContainText("h2");
    trust.current = "h3";
    await dialog.getByTestId("start-hooks-allow").click();
    await expect(dialog.getByTestId("start-error")).toContainText("hook commands changed", { timeout: 15_000 });
    expect(stub.posts[5]).toMatchObject({ trustHooks: "h2" });
    await expect(dialog).toBeVisible();
  });

  test("#F3 double submit posts once; Esc, ✕ and backdrop are ignored in flight; errors show text with retry; focus returns to the trigger", async ({ page }) => {
    const stub = await stubStart(page, {
      templates: [fixtureTemplate("plain")],
      start: replies(
        { status: 200, body: { teamId: "t_slow" }, delayMs: 3000 },
        { status: 403, body: { ok: false, error: "forbidden" } },
        { status: 409, body: { ok: false, error: "team_cap_reached" } },
        { status: 500, body: { ok: false, error: "internal_error" } },
      ),
    });
    const dialog = await openStartDialog(page);
    await dialog.getByTestId("start-template-plain").check();
    await dialog.getByTestId("start-goal").fill("g");
    const submit = dialog.getByTestId("start-submit");

    // In flight: two clicks, one POST; the button is disabled; Esc / ✕ / backdrop do nothing.
    await submit.dblclick();
    await expect(submit).toBeDisabled();
    await page.keyboard.press("Escape");
    await dialog.getByTestId("start-team-dialog-close").click({ force: true });
    await page.getByTestId("start-team-dialog-overlay").click({ position: { x: 2, y: 2 }, force: true });
    await expect(dialog).toBeVisible();
    expect(stub.posts).toHaveLength(1);
    // The slow start (3 s) succeeds → closes, focus returns to the folder menu trigger.
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect(triggerOf(page)).toBeFocused();

    // 403 / 409 / 500 → error text, Start enabled again (retry); Esc then cancels without a POST.
    const again = await openStartDialog(page);
    await again.getByTestId("start-template-plain").check();
    await again.getByTestId("start-goal").fill("g");
    for (const [i, text] of [
      [2, /not allowed/i],
      [3, /too many teams/i],
      [4, /could not be started/i],
    ] as const) {
      await again.getByTestId("start-submit").click();
      await expect(again.getByTestId("start-error")).toHaveText(text, { timeout: 15_000 });
      await expect(again.getByTestId("start-submit")).toBeEnabled();
      expect(stub.posts).toHaveLength(i);
    }
    await page.keyboard.press("Escape");
    await expect(again).toHaveCount(0);
    expect(stub.posts, "Esc cancels without a POST").toHaveLength(4);
    await expect(triggerOf(page)).toBeFocused();
  });

  test("the Start action exists once per folder and not on the session card placement", async ({ page }) => {
    await gotoDashboard(page);
    await ensureGitSession(page);
    await expandFolder(page, CWD);
    await triggerOf(page).click();
    await expect(page.getByTestId("folder-menu-item-agent-teams-start")).toHaveCount(1);
  });
});
