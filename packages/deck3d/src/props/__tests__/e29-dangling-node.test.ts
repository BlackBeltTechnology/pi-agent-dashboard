/**
 * E29 — a `node:<id>` role naming a node that does not exist is a *warning*
 * (exit 0, kept inert), never an error, and the prop is absent from the
 * embedded `window.__DECK_PROPS` map (nothing is rendered in its place).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { flowchartIR } from "../../ir/__tests__/fixtures.js";
import type { PropOverride } from "../../ir/types.js";
import { sha256 } from "../fetch.js";
import { vendoredPath } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

function cli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

/** Flowchart deck (slide `intro`, nodes `A`/`B`) with a dangling `node:Foo` prop. */
function danglingDeck(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-e29-"));
  const ir = flowchartIR();
  const bytes = new Uint8Array(readFileSync(vendoredPath("robot")));
  ir.overrides.props = [
    {
      source: "vendored",
      id: "robot",
      licence: "CC0-1.0",
      author: "deck3d corpus",
      sha256: sha256(bytes),
      slide: "intro",
      role: "node:Foo",
    } satisfies PropOverride,
  ];
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  // A cache file exists, yet the inert prop must still not be embedded.
  mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
  writeFileSync(join(dir, ".deck3d", "props", "vendored-robot.glb"), bytes);
  return dir;
}

function inlineJson(html: string, marker: string, terminator: string): unknown {
  const match = new RegExp(`${marker}=(\\{.*?\\})${terminator}`, "s").exec(html);
  expect(match, `inline JSON for ${marker} missing from deck.html`).not.toBeNull();
  return JSON.parse((match as RegExpExecArray)[1]);
}

describe("E29 dangling node role", () => {
  it("validate exits 0 with a warning naming the prop and the missing node", () => {
    const r = cli(["validate", "deck.json"], danglingDeck());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("valid");
    expect(r.stderr).toContain("warn");
    expect(r.stderr).toContain("robot");
    expect(r.stderr).toContain("Foo");
  });

  it("render exits 0 and leaves the inert prop out of the embedded map", () => {
    const dir = danglingDeck();
    const r = cli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(dir, "deck.html"), "utf8");
    const props = inlineJson(html, "window\\.__DECK_PROPS", ";</script>") as Record<string, string>;
    expect(Object.keys(props)).not.toContain("vendored-robot");
    expect(props).toEqual({});
    const deck = inlineJson(html, "window\\.__DECK", ";window\\.__DECK_FONT") as { props?: unknown[] };
    expect(deck.props ?? []).toEqual([]);
  });

  it("the dangling prop is not cached-required: render wrote html", () => {
    const dir = danglingDeck();
    const r = cli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(dir, "deck.html"))).toBe(true);
  });
});

describe.skipIf(!hasChromium)("E29 dangling node role (chromium)", () => {
  it("the browser sees no embedded prop for the dangling role", async () => {
    const dir = danglingDeck();
    const render = cli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(render.status, render.stderr).toBe(0);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`file://${join(dir, "deck.html")}`);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      const props = await page.evaluate(() => window.__DECK_PROPS ?? {});
      expect(Object.keys(props)).not.toContain("vendored-robot");
      expect(await page.evaluate(() => window.__deck3d?.current())).toBe(1);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
