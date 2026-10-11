/**
 * `serve` and the variant loop — change deck3d-pptx-import, test-plan
 * #F4–#F7. Exemplar: `serve.test.ts`.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { run } from "../../cli.js";
import { stubChrome } from "../../fx/stub-assets.js";
import { type ServeHandle, startServe } from "../index.js";

const hasChromium = await chromiumAvailable();
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

const open: ServeHandle[] = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

const STYLE = {
  version: 1,
  steps: [
    {
      id: "fidelity",
      title: "Fidelity",
      question: "How faithful?",
      slides: ["opening"],
      round: 1,
      variants: ["A", "B", "C"].map((n) => ({ name: n, label: `Variant ${n}`, overrides: { deck: { mode: n === "A" ? "light" : "dark" } } })),
    },
  ],
};

async function served(extra: { assets?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-serve-var-"));
  writeFileSync(join(dir, "deck.md"), "# Opening\n\n- one\n\n# Second\n\n- two\n");
  writeFileSync(join(dir, "style.json"), `${JSON.stringify(STYLE, null, 2)}\n`);
  const h = await startServe(join(dir, "deck.md"), { run, debounceMs: 40 });
  open.push(h);
  if (extra.assets) {
    writeFileSync(join(dir, "mark.png"), stubChrome());
    const ir = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    ir.overrides.assets = [{ id: "mark", path: "mark.png", sha256: sha(join(dir, "mark.png")), mime: "image/png" }];
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  }
  return { dir, h };
}

async function until(cond: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!hasChromium)("serve ?variant= (chromium)", () => {
  it("cycles variants with V without writing anything (F4)", async () => {
    const { dir, h } = await served();
    const beforeDeck = sha(join(dir, "deck.json"));
    const beforeStyle = sha(join(dir, "style.json"));
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage();
      await page.goto(`${h.url}/?variant=fidelity:B`);
      await page.waitForFunction(() => window.__deck3d !== undefined);
      const name = () => page.evaluate(() => (window as unknown as { __DECK3D_VARIANT?: { name: string } }).__DECK3D_VARIANT?.name);
      expect(await name()).toBe("B");
      for (const next of ["C", "A"]) {
        await page.keyboard.press("v");
        await page.waitForFunction((n) => (window as unknown as { __DECK3D_VARIANT?: { name: string } }).__DECK3D_VARIANT?.name === n, next);
        await page.waitForFunction(() => window.__deck3d !== undefined);
      }
      expect(await name()).toBe("A");
      await page.close();
    } finally {
      await browser.close();
    }
    expect(sha(join(dir, "deck.json"))).toBe(beforeDeck);
    expect(sha(join(dir, "style.json"))).toBe(beforeStyle);
  }, 120_000);

  it("ignores V without a variant param and while a text input has focus (F5)", async () => {
    const { h } = await served();
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      for (const mode of ["no-param", "focused-input"] as const) {
        const page = await browser.newPage();
        const navs: string[] = [];
        page.on("request", (r) => {
          if (r.isNavigationRequest()) navs.push(r.url());
        });
        await page.goto(mode === "no-param" ? h.url : `${h.url}/?variant=fidelity:B`);
        await page.waitForFunction(() => window.__deck3d !== undefined);
        if (mode === "focused-input") {
          await page.click("#deck3d-hud-toggle");
          // The autoplay field sits in the collapsed Motion block: open it first.
          await page.locator("summary", { hasText: "Motion" }).click();
          await page.locator("#deck3d-hud-autoplay").focus();
          expect(await page.evaluate(() => document.activeElement?.id)).toBe("deck3d-hud-autoplay");
        }
        const before = navs.length;
        await page.keyboard.press("v");
        await page.waitForTimeout(500);
        expect(navs.length, mode).toBe(before);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("disables Save and Apply while a variant is shown (F6)", async () => {
    const { h } = await served();
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage();
      await page.goto(`${h.url}/?variant=fidelity:A`);
      await page.waitForFunction(() => window.__deck3d !== undefined);
      await page.click("#deck3d-hud-toggle");
      await page.locator("#deck3d-hud-save").waitFor();
      expect(await page.locator("#deck3d-hud-save").isDisabled()).toBe(true);
      expect(await page.locator("#deck3d-hud-apply").isDisabled()).toBe(true);
      expect(await page.locator("#deck3d-hud").innerText()).toContain("variants pick");
      // Without the param they stay enabled.
      const plain = await browser.newPage();
      await plain.goto(h.url);
      await plain.waitForFunction(() => window.__deck3d !== undefined);
      await plain.click("#deck3d-hud-toggle");
      await plain.locator("#deck3d-hud-save").waitFor();
      expect(await plain.locator("#deck3d-hud-save").isDisabled()).toBe(false);
      // An unknown variant falls back with a visible notice.
      const unknown = await browser.newPage();
      await unknown.goto(`${h.url}/?variant=fidelity:Z`);
      await unknown.waitForFunction(() => window.__deck3d !== undefined);
      expect(await unknown.locator("#deck3d-variant-notice").innerText()).toContain("Unknown variant");
    } finally {
      await browser.close();
    }
  }, 120_000);
});

describe("serve Apply validates inside the lock (R3-B3)", () => {
  it("validates against the deck a concurrent pick left, not the one it saw before waiting", async () => {
    const { withStyleLockAsync } = await import("../../variants/style.js");
    const { dir, h } = await served();
    await h.settled();
    // `cameraPath` is only valid on a slide whose resolved transition is "path".
    const patch = { slides: { opening: { cameraPath: { keys: [{ t: 0.5, offset: [0.1, 0.1, 0] }] } } } };
    let response: Promise<Response> | undefined;
    await withStyleLockAsync(dir, async () => {
      // The Apply arrives while a pick holds the lock…
      response = fetch(`${h.url}/__apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      await new Promise((r) => setTimeout(r, 400));
      // …and the pick (a locked writer) makes the patch valid before it releases.
      const ir = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
      ir.overrides.slides = { ...(ir.overrides.slides ?? {}), opening: { ...(ir.overrides.slides?.opening ?? {}), transition: "path" } };
      writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
    });
    const res = await (response as Promise<Response>);
    expect(res.status, await res.clone().text()).toBe(200);
    const after = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    expect(after.overrides.slides.opening.transition).toBe("path");
    expect(after.overrides.slides.opening.cameraPath.keys).toHaveLength(1);
  }, 60_000);
});

describe("serve and the deck lock (R2-B2)", () => {
  it("defers its rebuild while another process holds the deck lock, then rebuilds once", async () => {
    const { dir, h } = await served();
    await h.settled();
    const lock = join(dir, "style.json.lock");
    writeFileSync(lock, `${process.pid}:pick`); // a live holder, e.g. `variants pick`
    const count = h.rebuilds();
    writeFileSync(join(dir, "deck.md"), "# Opening\n\n- one\n\n# Second\n\n- two\n\n# Third\n\n- three\n");
    await new Promise((r) => setTimeout(r, 900));
    expect(h.rebuilds(), "no rebuild while the lock is held").toBe(count);
    expect(readFileSync(join(dir, "deck.json"), "utf8")).not.toContain("Third");
    unlinkSync(lock);
    await until(() => h.rebuilds() === count + 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(h.rebuilds()).toBe(count + 1);
    expect(readFileSync(join(dir, "deck.json"), "utf8")).toContain("Third");
  }, 60_000);
});

describe("serve rebuild triggers (F7)", () => {
  it("rebuilds on style.json and asset edits, defers while a pick is pending, then rebuilds once", async () => {
    const { dir, h } = await served({ assets: true });
    await h.settled();
    await until(() => h.rebuilds() >= 2);
    await h.settled();
    let count = h.rebuilds();

    // style.json edit → one rebuild.
    writeFileSync(join(dir, "style.json"), `${JSON.stringify({ ...STYLE, source: "edited" }, null, 2)}\n`);
    await until(() => h.rebuilds() === count + 1);
    await h.settled();
    count = h.rebuilds();

    // asset file rewritten → one rebuild (the pin follows the file).
    writeFileSync(join(dir, "mark.png"), stubChrome().map((b, i) => (i > 60 ? b ^ 1 : b)));
    await until(() => h.rebuilds() === count + 1);
    await h.settled();
    expect(h.lastError()).toBeNull();
    count = h.rebuilds();

    // A pick in progress: nothing rebuilds while `pending` is true…
    const pendingStyle = JSON.parse(JSON.stringify(STYLE));
    pendingStyle.steps[0].pending = true;
    writeFileSync(join(dir, "style.json"), `${JSON.stringify(pendingStyle, null, 2)}\n`);
    const ir = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    ir.overrides.deck = { ...(ir.overrides.deck ?? {}), mode: "light" };
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
    await new Promise((r) => setTimeout(r, 900));
    expect(h.rebuilds()).toBe(count);

    // …and exactly one runs after it clears.
    pendingStyle.steps[0].pending = false;
    pendingStyle.steps[0].picked = "A";
    writeFileSync(join(dir, "style.json"), `${JSON.stringify(pendingStyle, null, 2)}\n`);
    await until(() => h.rebuilds() === count + 1);
    await new Promise((r) => setTimeout(r, 700));
    expect(h.rebuilds()).toBe(count + 1);
  }, 120_000);
});
