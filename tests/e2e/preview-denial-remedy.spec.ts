/**
 * E2E: surface-denial-remedy-in-previews (test-plan #F1-#F13, #X1, #X2).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the outcome mapping, the provenance reducer, the opt-out
 * inventory and every notice variant in jsdom. Only a REAL browser against the
 * REAL server shows that a click-opened image reaches the dialog through
 * `fetch` → `blob:`, that an agent-opened surface never does, and that the
 * media/PDF click-to-ask path ends in a playing stream.
 *
 * HARNESS STATE (mirrors access-grant-dialog.spec.ts)
 * ---------------------------------------------------
 * `beforeAll` flips `hostGate.mode=enforce` + `accessGrants.promptEnabled` in
 * the container; `afterAll` restores `config.json` and the grant stores
 * byte-for-byte and removes every probe directory and link.
 *
 * FRESH SUBJECTS: the 120 s post-answer backoff is per subject, so every test
 * creates its own outside directory. Agent auto-opens are an absolute-path
 * `write` (write detection accepts it), one fixed `/tmp/denial-canvas-<id>`
 * per test (an in-cwd symlink would pass the logical containment layer ①).
 *
 * DISCLOSURE: `promptOutcome` is disclosed only to an authenticated or
 * genuinely local caller (design D5). The host browser reaches the container
 * over the Docker bridge — neither — so a paired-device bearer rides every
 * file-route request (`page.route`), exactly what an authenticated remote
 * operator sends.
 *
 * Covered at L1 instead (`image-denial-transport.test.tsx`), because their
 * L3 premise is unreachable in the product:
 *   #F2 — a chat file link to an outside path resolves through
 *         `resolve-mention`, which consumes grants but never originates one,
 *         so the link renders "not found" and never opens the overlay;
 *   #F3 — an outside image embedded in markdown fails inline (silent by
 *         design) and renders a non-clickable placeholder, so no lightbox
 *         can open on it.
 *
 * PACING: the filesystem plane allows 5 prompts per minute (design D9 of
 * add-access-grant-dialog); `promptBudget()` spaces the prompt-raising steps.
 *
 * NAVIGATION: an operator open is the editor deep link, driven by a client-side
 * `history.pushState` (a full `goto` would reload the page, drop the socket and
 * abort a held request). A tab click behind the modal dialog uses a synthetic
 * `dispatchEvent("click")`.
 *
 * See change: surface-denial-remedy-in-previews.
 */
import { execSync } from "node:child_process";
import type { Locator, Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { pairDeviceBearer } from "./helpers/bridge-credential.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

// No `__`: markdown would bold it and split the chat file link.
const ROOT = "/fixtures/denial-e2e";
const CANVAS = "/tmp/denial-canvas";
const CONFIG = "/home/pi/.pi/dashboard/config.json";
const STORES = [CONFIG, "/home/pi/.pi/dashboard/access-grants.json", "/home/pi/.pi/dashboard/access-refusals.json"];

/** Timestamps of the prompts this spec raised (single worker, sequential). */
const raised: number[] = [];
/** Wait until one more prompt fits the plane's 5-per-minute window, then count it. */
async function promptBudget(page: Page): Promise<void> {
  const now = Date.now();
  const recent = raised.filter((t) => now - t < 61_000);
  if (recent.length >= 5) await page.waitForTimeout(61_000 - (now - recent[recent.length - 5]));
  raised.push(Date.now());
}

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==";
const WEBM_B64 = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAQoEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggQS7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIKp3vOOxQyQucgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QCYloA4JCwgRC6gRCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIKp3vOOxQyQtnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjAwMDAwMDAwMAAfQ7Z1QmnngQCjvIEAAICwAgCdASoQABAAAEcIhYWIhYSIAgICdaoD+AIM/SgA/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOVgQAoALEBAAEQEAAYABhYL/QACAAAo5WBAFAAsQEAARAQABgAGFgv9AAIAACjlYEAeACxAQABEBAAGAAYWC/0AAgAAKOVgQCgALEBAAEQEAAYABhYL/QACAAAo5WBAMgAsQEAARAQABgAGFgv9AAIAACjlYEA8ACxAQABEBAAGAAYWC/0AAgAAKOVgQEYALEBAAEQEBRgAGFgv9AAIAAAo5WBAUAAsQEAARAQABgAGFgv9AAIAACjlYEBaACxAQABEBAAGAAYWC/0AAgAAKOVgQGQALEBAAEQEAAYABhYL/QACAAAo5WBAbgAsQEAARAQABgAGFgv9AAIAACjlYEB4ACxAQABEBAAGAAYWC/0AAgAAKOVgQIIALEBAAEQEAAYABhYL/QACAAAo5WBAjAAsQEAARAQABgAGFgv9AAIAACjlYECWACxAQABEBAAGAAYWC/0AAgAAKOVgQKAALEBAAEQEAAYABhYL/QACAAAo5WBAqgAsQEAARAQABgAGFgv9AAIAACjlYEC0ACxAQABEBAUYABhYL/QACAAAKOVgQL4ALEBAAEQEAAYABhYL/QACAAAo5WBAyAAsQEAARAQABgAGFgv9AAIAACjlYEDSACxAQABEBAAGAAYWC/0AAgAAKOVgQNwALEBAAEQEAAYABhYL/QACAAAo5WBA5gAsQEAARAQABgAGFgv9AAIAACjlYEDwACxAQABEBAAGAAYWC/0AAgAABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=";

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}

function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

function patchConfig(patch: Record<string, unknown>): void {
  inContainer(`
    const fs = require("node:fs");
    const p = ${JSON.stringify(CONFIG)};
    const cur = JSON.parse(fs.readFileSync(p, "utf8"));
    const patch = ${JSON.stringify(patch)};
    for (const [k, v] of Object.entries(patch)) {
      cur[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(cur[k] ?? {}), ...v } : v;
    }
    fs.writeFileSync(p + ".e2e.tmp", JSON.stringify(cur, null, 2));
    fs.renameSync(p + ".e2e.tmp", p);
  `);
}

type Kind = "png" | "webm" | "pdf";
/** A fresh outside directory holding `files`; returns its REAL path (the canonical subject). */
function freshDir(tag: string, files: Record<string, Kind>): string {
  const dir = `${ROOT}/${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return inContainer(`
    const fs = require("node:fs");
    const dir = ${JSON.stringify(dir)};
    fs.mkdirSync(dir, { recursive: true });
    const files = ${JSON.stringify(files)};
    for (const [name, kind] of Object.entries(files)) {
      const p = dir + "/" + name;
      if (kind === "pdf") fs.copyFileSync(${JSON.stringify(`${FIXTURE_GIT}/doc.pdf`)}, p);
      else fs.writeFileSync(p, Buffer.from(kind === "png" ? ${JSON.stringify(PNG_B64)} : ${JSON.stringify(WEBM_B64)}, "base64"));
    }
    process.stdout.write(fs.realpathSync(dir));
  `);
}

const dialog = (page: Page) => page.getByTestId("grant-dialog");
const notice = (page: Page) => page.getByTestId("denial-notice");
const editor = (page: Page) => page.getByTestId("split-editor-pane");

async function sessionIdOf(card: Locator): Promise<string> {
  const id = await card.getAttribute("data-session-id");
  if (!id) throw new Error("session card has no data-session-id");
  return id;
}

let bearer = "";

/** Dashboard up, a session, the capability landed, file routes authenticated. */
async function ready(page: Page, fresh = false): Promise<string> {
  await page.route(/\/api\/(file|session-file)/, (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${bearer}` } }),
  );
  const card = fresh ? await spawnFreshGitSession(page) : await ensureGitSession(page);
  await card.click();
  await page.waitForTimeout(1_000); // one settle after the socket so `grant_channel` has landed
  return sessionIdOf(card);
}

/** Operator open: the editor deep link, client-side (no reload). */
async function operatorOpen(page: Page, sessionId: string, file: string): Promise<void> {
  const url = `/session/${sessionId}/editor?file=${encodeURIComponent(file)}`;
  await page.evaluate((u) => window.history.pushState(null, "", u), url);
}

async function imageLoaded(img: Locator): Promise<boolean> {
  return img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
}

/** No dialog for `ms` (sampled, so a flash is caught). */
async function expectNoDialogFor(page: Page, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    expect(await dialog(page).count()).toBe(0);
    await page.waitForTimeout(250);
  }
}

let saved: Record<string, string | null> = {};

test.describe("preview denial remedy (surface-denial-remedy-in-previews)", () => {
  test.skip(process.env.PI_DASHBOARD_DISABLE_GRANT_PROMPT === "1", "prompting force-disabled by the kill switch");

  test.beforeAll(async () => {
    bearer = await pairDeviceBearer(BASE_URL);
    saved = JSON.parse(
      inContainer(`
        const fs = require("node:fs");
        const out = {};
        for (const p of ${JSON.stringify(STORES)}) out[p] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
        process.stdout.write(JSON.stringify(out));
      `),
    );
    execSync(`docker exec ${containerName()} sh -c 'rm -rf ${ROOT} ${CANVAS}-* && mkdir -p ${ROOT}'`);
    patchConfig({ hostGate: { mode: "enforce" }, accessGrants: { promptEnabled: true } });
  });

  test.afterAll(() => {
    inContainer(`
      const fs = require("node:fs");
      const saved = ${JSON.stringify(saved)};
      for (const [p, body] of Object.entries(saved)) {
        if (body === null) { try { fs.unlinkSync(p); } catch {} }
        else { fs.writeFileSync(p + ".e2e.tmp", body); fs.renameSync(p + ".e2e.tmp", p); }
      }
    `);
    execSync(`docker exec ${containerName()} sh -c 'rm -rf ${ROOT} ${CANVAS}-*'`);
  });

  test("#F1 a click-opened image raises the dialog and renders after Allow once", async ({ page }) => {
    const id = await ready(page);
    const dir = freshDir("f1", { "a.png": "png" });
    await promptBudget(page);
    await operatorOpen(page, id, `${dir}/a.png`);
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(dir);
    await dialog(page).getByTestId("grant-allow-once").click();
    const img = editor(page).locator("img").first();
    await expect.poll(() => imageLoaded(img), { timeout: 15_000 }).toBe(true);
  });

  test("#F4 a canvas auto-open never prompts; Ask for access does", async ({ page }) => {
    const dir = `${CANVAS}-f4`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await ready(page, true);
    await sendPrompt(page, "[[faux:denial-write-png-f4]] go");
    await expect(notice(page)).toBeVisible({ timeout: 30_000 });
    await expectNoDialogFor(page, 5_000);
    await promptBudget(page);
    await notice(page).getByRole("button", { name: "Ask for access" }).click();
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(dir);
    await dialog(page).getByTestId("grant-deny").click();
  });

  test("#F5 an undeclared /view surface never prompts; the denials are ineligible", async ({ page }) => {
    const dir = freshDir("f5", { "a.pdf": "pdf" });
    inContainer(`require("node:fs").writeFileSync(${JSON.stringify(`${dir}/b.md`)}, "# probe\\n");`);
    await ready(page);
    const enc = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    for (const f of ["a.pdf", "b.md"]) {
      await page.evaluate(
        (u) => window.history.pushState(null, "", u),
        `/folder/${enc(FIXTURE_GIT)}/view?path=${encodeURIComponent(`${dir}/${f}`)}`,
      );
      await expectNoDialogFor(page, 5_000);
    }
    const log = execSync(`docker exec ${containerName()} sh -c 'cat /home/pi/.pi/dashboard/server.log 2>/dev/null || true'`, {
      encoding: "utf8",
    });
    expect(log).toContain(`degraded:ineligible plane=filesystem subject=${JSON.stringify(dir)}`);
  });

  test("#F6 an auto-open that re-focuses an operator-opened tab does not prompt", async ({ page }) => {
    const file = `${CANVAS}-f6/a.png`;
    // Writable by the agent's `write` (pi runs as another user than `docker exec`).
    execSync(`docker exec ${containerName()} sh -c 'mkdir -p ${CANVAS}-f6 && echo x > ${file} && chmod -R a+rwX ${CANVAS}-f6'`);
    await page.setViewportSize({ width: 1280, height: 800 });
    const id = await ready(page, true);
    // Operator-open the path while prompting is OFF (no dialog, no backoff),
    // then make the tab inactive and turn prompting back on.
    patchConfig({ accessGrants: { promptEnabled: false } });
    await operatorOpen(page, id, file);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await operatorOpen(page, id, "README.md");
    // With the split open an auto-open only re-signals the tab in the
    // background; it re-focuses (activates + remounts) when the split is closed.
    // Leave the editor deep-link route first: while it is active it keeps the split open.
    await page.evaluate((u) => window.history.pushState(null, "", u), `/session/${id}`);
    await page.getByTestId("layout-mode-closed").click();
    await expect(editor(page)).toHaveCount(0);
    patchConfig({ accessGrants: { promptEnabled: true } });
    await sendPrompt(page, "[[faux:denial-write-png-f6]] go");
    await expect(notice(page)).toHaveAttribute("data-outcome", "ineligible", { timeout: 30_000 }); // re-focused, remounted opted out
    await expectNoDialogFor(page, 5_000);
  });

  test("#F7 video: no dialog on load, click-to-ask warns first, Allow always plays", async ({ page }) => {
    const id = await ready(page);
    const dir = freshDir("f7", { "a.webm": "webm" });
    await operatorOpen(page, id, `${dir}/a.webm`);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await expectNoDialogFor(page, 2_000);
    await expect(notice(page)).toContainText("admits only a check");
    await promptBudget(page);
    await notice(page).getByRole("button", { name: "Ask for access" }).click();
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await dialog(page).getByTestId("grant-allow-always").click();
    const video = editor(page).locator("video").first();
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });

  test("#F8 video: Allow once admits only the check, and the notice says so", async ({ page }) => {
    const id = await ready(page);
    const dir = freshDir("f8", { "a.webm": "webm" });
    await operatorOpen(page, id, `${dir}/a.webm`);
    await expect(notice(page).getByRole("button", { name: "Ask for access" })).toBeVisible({ timeout: 15_000 });
    await promptBudget(page);
    await notice(page).getByRole("button", { name: "Ask for access" }).click();
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await dialog(page).getByTestId("grant-allow-once").click();
    await expect(notice(page)).toContainText("admitted only the check", { timeout: 15_000 });
    await expect(notice(page).getByRole("button")).toHaveCount(0);
  });

  test("#F9 PDF: no dialog on load, Ask for access, Allow always renders a page", async ({ page }) => {
    const id = await ready(page);
    const dir = freshDir("f9", { "a.pdf": "pdf" });
    await operatorOpen(page, id, `${dir}/a.pdf`);
    await expect(notice(page)).toBeVisible({ timeout: 15_000 });
    await expectNoDialogFor(page, 2_000);
    await promptBudget(page);
    await notice(page).getByRole("button", { name: "Ask for access" }).click();
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await dialog(page).getByTestId("grant-allow-always").click();
    await expect(editor(page).locator(".pdfViewer .page").first()).toBeVisible({ timeout: 20_000 });
  });

  test("#F10 the default config explains itself", async ({ page }) => {
    patchConfig({ hostGate: { mode: "report" }, accessGrants: { promptEnabled: false } });
    try {
      const id = await ready(page);
      const dir = freshDir("f10", { "a.png": "png" });
      await operatorOpen(page, id, `${dir}/a.png`);
      await expect(notice(page)).toHaveAttribute("data-outcome", "off", { timeout: 15_000 });
      await expect(notice(page)).toContainText("Access prompts are off");
      await expect(notice(page).getByRole("button")).toHaveCount(0);
    } finally {
      patchConfig({ hostGate: { mode: "enforce" }, accessGrants: { promptEnabled: true } });
    }
  });

  test("#F11 busy, then Ask again once the open question is answered", async ({ page }) => {
    const id = await ready(page);
    const a = freshDir("f11a", { "a.png": "png" });
    const b = freshDir("f11b", { "b.png": "png" });
    await promptBudget(page);
    await operatorOpen(page, id, `${a}/a.png`);
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(a, { timeout: 15_000 });
    await operatorOpen(page, id, `${b}/b.png`);
    await expect(notice(page)).toHaveAttribute("data-outcome", "busy", { timeout: 15_000 });
    await dialog(page).getByTestId("grant-deny").click();
    await expect(dialog(page)).toHaveCount(0);
    await promptBudget(page);
    await notice(page).getByRole("button", { name: "Ask again" }).click();
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(b, { timeout: 15_000 });
    await dialog(page).getByTestId("grant-deny").click();
  });

  test("#F12 recently answered: a second file in the folder within the backoff", async ({ page }) => {
    // A second FILE, not the same URL: the route's `max-age=60` makes a re-fetch
    // of the same URL a cache hit, which is correct and loads the image.
    const id = await ready(page);
    const dir = freshDir("f12", { "a.png": "png", "b.png": "png" });
    await promptBudget(page);
    await operatorOpen(page, id, `${dir}/a.png`);
    await dialog(page).getByTestId("grant-allow-once").click({ timeout: 15_000 });
    await expect.poll(() => imageLoaded(editor(page).locator("img").first()), { timeout: 15_000 }).toBe(true);
    await operatorOpen(page, id, `${dir}/b.png`);
    await expect(notice(page)).toHaveAttribute("data-outcome", "recently-answered", { timeout: 15_000 });
    await expect(notice(page).getByRole("button")).toHaveCount(0);
    await expectNoDialogFor(page, 2_000);
  });

  test("#F13 an agent-created entry cannot give the operator a second dialog", async ({ page }) => {
    const b = freshDir("f13b", { "b.png": "png" });
    await page.setViewportSize({ width: 1280, height: 800 });
    const id = await ready(page, true);
    await sendPrompt(page, "[[faux:denial-write-png-f13]] go");
    await expect(notice(page)).toHaveAttribute("data-outcome", "ineligible", { timeout: 30_000 });
    await promptBudget(page);
    await operatorOpen(page, id, `${b}/b.png`);
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(b, { timeout: 15_000 });
    // Back to A (behind the modal): an operator activation, so A's viewer
    // remounts eligible and JOINS the agent-created entry for A.
    await page.getByRole("tab", { name: /a\.png/ }).first().dispatchEvent("click");
    await expect(notice(page)).toHaveAttribute("data-outcome", "busy", { timeout: 15_000 });
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(b);
    await expect(dialog(page).getByTestId("grant-dialog-queued")).toHaveCount(0);
    await dialog(page).getByTestId("grant-deny").click();
  });

  test("#X1 a held image shows its loading state, then the unanswered notice", async ({ page }) => {
    test.setTimeout(200_000);
    const id = await ready(page);
    const dir = freshDir("x1", { "a.png": "png" });
    await promptBudget(page);
    await operatorOpen(page, id, `${dir}/a.png`);
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(editor(page).getByText("Loading…")).toBeVisible();
    await expect(notice(page)).toHaveAttribute("data-outcome", "unanswered", { timeout: 150_000 });
    await expect(notice(page).getByRole("button", { name: "Ask again" })).toBeVisible();
  });

  test("#X2 losing the socket removes the ask", async ({ page }) => {
    const routes: WebSocketRoute[] = [];
    const state = { blocked: false };
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      if (state.blocked) {
        void ws.close();
        return;
      }
      routes.push(ws);
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => ws.send(m));
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await ready(page, true);
    await sendPrompt(page, "[[faux:denial-write-png-x2]] go");
    await expect(notice(page).getByRole("button", { name: "Ask for access" })).toBeVisible({ timeout: 30_000 });
    state.blocked = true;
    for (const r of routes) await r.close();
    await expect(notice(page).getByRole("button", { name: "Ask for access" })).toHaveCount(0, { timeout: 15_000 });
    await expect(notice(page)).toContainText("Settings → Access");
  });
});
