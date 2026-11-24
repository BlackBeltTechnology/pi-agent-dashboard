import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixture.js";
import { allowOpaqueOrigin, LP_MOCK, type LpMock, startLpMock } from "./mock-site.js";

/**
 * L3 — the mock site inside a WRAPPER page, in an opaque origin (`<iframe sandbox="allow-scripts">`) and with a real origin
 * (`allow-scripts allow-same-origin`): the same document tier 5 frames, without the dashboard. Rows: test-plan #F53 (D7/D11
 * opaque degrade) and #F54 (D11 (9) message source checks). The mock site runs on the host exactly as `serve_mock_site` starts it.
 * See change: serve-live-previews-on-capability-origin (D7, D11).
 */
let mock: LpMock | undefined;
test.afterEach(async () => {
  await mock?.dispose();
  mock = undefined;
});

/** Serve `/wrap` from the upstream: the mock framed with `sandbox`, plus (optionally) a sibling `#b` frame to forge messages from. */
function wrapper(upstream: { route(p: string, b: string): void; url: string }, sandbox: string, opts: { sibling?: boolean } = {}): string {
  upstream.route(
    "/wrap",
    `<!doctype html><title>wrapper</title>
<iframe id="a" sandbox="${sandbox}" src="${mock?.url}/" style="width:900px;height:700px"></iframe>
${opts.sibling ? `<iframe id="b" sandbox="allow-scripts" srcdoc="<p>forger</p>" style="width:200px;height:100px"></iframe>` : ""}`,
  );
  return `${upstream.url}/wrap`;
}

const pageErrors = (page: Page) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`${e.name}: ${e.message}`));
  return errs;
};

test("T.F53 / #F53 opaque degrade: lists and panes render, the notice names what is off, Highlights still toggles; a real origin shows no notice", async ({ page, upstream }) => {
  mock = await startLpMock();
  await allowOpaqueOrigin(page, mock);
  const errors = pageErrors(page);

  // --- opaque: sandbox="allow-scripts" (window.origin === "null") ---
  await page.goto(wrapper(upstream, "allow-scripts"));
  const shell = page.frameLocator("#a");
  await expect(shell.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 });
  for (const el of await shell.locator(".mk-pane").all()) await el.scrollIntoViewIfNeeded();
  await expect(shell.locator("iframe[data-pane]")).toHaveCount(6, { timeout: 30_000 });
  for (const n of [1, 2, 3]) for (const side of ["current", "proposed"]) await expect(shell.frameLocator(`iframe[data-pane="${LP_MOCK}/${n}/${side}"]`).locator(".mk-ring").first(), `ring ${n}/${side}`).toBeVisible();
  const note = shell.getByTestId("mk-opaque-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText(/storage unavailable in this preview/i);
  await expect(note).toContainText(/pane-height memory/i);
  await expect(note).toContainText(/find-in-frame/i);
  await expect(note).toContainText(/highlight sync/i);
  const a = page.frames().find((f) => f.url() === `${mock.url}/`) as Frame;
  expect(await a.evaluate(() => window.origin), "the shell really is opaque").toBe("null");
  expect(await a.evaluate(() => { try { localStorage.getItem("x"); return "readable"; } catch { return "blocked"; } })).toBe("blocked");
  // Highlights still toggles for this page view (no storage involved).
  const highlights = shell.getByLabel("Highlights");
  await expect(highlights).toBeChecked();
  await highlights.uncheck();
  await expect.poll(() => a.evaluate(() => document.documentElement.classList.contains("mk-no-rings"))).toBe(true);
  await highlights.check();
  await expect.poll(() => a.evaluate(() => document.documentElement.classList.contains("mk-no-rings"))).toBe(false);
  expect(errors.filter((e) => /SecurityError/.test(e)), "uncaught SecurityError").toEqual([]);

  // --- real origin: sandbox="allow-scripts allow-same-origin" ---
  await page.goto(wrapper(upstream, "allow-scripts allow-same-origin"));
  const real = page.frameLocator("#a");
  await expect(real.locator(".mk-frame")).toHaveCount(3, { timeout: 30_000 });
  await expect(real.getByTestId("mk-opaque-note")).toHaveCount(0);
  const b = page.frames().find((f) => f.url() === `${mock.url}/`) as Frame;
  expect(await b.evaluate(() => window.origin)).toBe(mock.url);
  await real.getByLabel("Highlights").uncheck();
  expect(await b.evaluate(() => localStorage.getItem("mk-rings")), "storage works on a real origin").toBe("off");
  await page.reload();
  await expect(page.frameLocator("#a").getByLabel("Highlights")).not.toBeChecked();
  expect(errors.filter((e) => /SecurityError/.test(e)), "uncaught SecurityError").toEqual([]);
});

test("T.F54 / #F54 message source checks: a sibling frame's forged missing report, height and pause are ignored; genuine pane messages still count", async ({ page, upstream }) => {
  mock = await startLpMock({ scripted: true });
  await allowOpaqueOrigin(page, mock);
  await page.goto(wrapper(upstream, "allow-scripts", { sibling: true }));
  const shell = page.frameLocator("#a");
  await expect(shell.locator(".mk-frame")).toHaveCount(4, { timeout: 30_000 });
  for (const el of await shell.locator(".mk-pane").all()) await el.scrollIntoViewIfNeeded();
  await shell.locator(`[id="r-${LP_MOCK}/4/proposed"]`).scrollIntoViewIfNeeded();
  const a = page.frames().find((f) => f.url() === `${mock.url}/`) as Frame;
  const forger = page.frames().find((f) => f.url() === "about:srcdoc") as Frame;
  expect(await forger.evaluate(() => window.origin), "the forger is a sibling opaque frame").toBe("null");

  // Genuine pane traffic is accepted: the unfixtured request is listed and the panes reported heights.
  await expect(shell.locator(".mk-missing")).toContainText("GET /api/roles", { timeout: 30_000 });
  const paneHeight = (spec: string) => shell.locator(`iframe[data-pane="${spec}"]`).evaluate((e) => Math.round(e.getBoundingClientRect().height));
  await expect.poll(() => paneHeight(`${LP_MOCK}/3/proposed`)).not.toBe(240);
  const h0 = await paneHeight(`${LP_MOCK}/3/proposed`);
  const missing0 = await shell.locator(".mk-missing").innerText();

  // The scripted pane is running (its completed-loops counter advances); index of its iframe among the shell's frames:
  const health = shell.locator(`[data-pane-health="${LP_MOCK}/4/proposed"]`);
  const count = async () => Number(/loops: (\d+) completed/.exec(await health.innerText())?.[1] ?? "-1");
  await expect.poll(count, { timeout: 45_000 }).toBeGreaterThan(1);
  const idx = await a.evaluate((spec) => Array.from(document.querySelectorAll("iframe")).findIndex((f) => f.getAttribute("data-pane") === spec), `${LP_MOCK}/4/proposed`);
  const idx3 = await a.evaluate((spec) => Array.from(document.querySelectorAll("iframe")).findIndex((f) => f.getAttribute("data-pane") === spec), `${LP_MOCK}/3/proposed`);
  expect(idx).toBeGreaterThan(-1);

  // Forge from the sibling: missing report + height to the SHELL, pause to a PANE (it only listens to its parent).
  await forger.evaluate(
    ({ spec, idx, idx3 }) => {
      const shellWin = (parent as unknown as { frames: Window[] }).frames[0];
      shellWin.postMessage({ mkMissing: spec, method: "GET", path: "/forged-by-sibling" }, "*");
      shellWin.postMessage({ mkPane: spec, h: 9999 }, "*");
      const shellFrames = (shellWin as unknown as { frames: Window[] }).frames;
      shellFrames[idx].postMessage({ mkPause: true }, "*");
      shellFrames[idx3].postMessage({ mkHidden: true }, "*");
    },
    { spec: `${LP_MOCK}/3/proposed`, idx, idx3 },
  );
  await page.waitForTimeout(1_500);
  expect(await paneHeight(`${LP_MOCK}/3/proposed`), "forged height must not resize the pane").toBe(h0);
  expect(await shell.locator(".mk-missing").innerText()).not.toContain("forged-by-sibling");
  expect(await shell.locator(".mk-missing").innerText()).toBe(missing0);
  const c1 = await count();
  await page.waitForTimeout(2_500);
  expect(await count(), "a pause posted by a non-parent window must not stop the scripted pane").toBeGreaterThan(c1);

  // The genuine parent (the shell's own Pause button) still pauses it.
  await health.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(800);
  const c2 = await count();
  await page.waitForTimeout(2_500);
  expect(await count(), "the shell's own pause is honoured").toBe(c2);
});
