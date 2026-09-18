/**
 * E34 — a credits slide is derived at render time, never authored: any prop
 * with an attribution-requiring licence (not CC0, not `generated`) appends a
 * final `credits` slide naming author + licence (+ `modified: restyled` when
 * `restyle: palette`), it is addressable by deep link, and it never appears in
 * `deck.json`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { validIR } from "../../ir/__tests__/fixtures.js";
import type { PropOverride } from "../../ir/types.js";
import { sha256 } from "../fetch.js";
import { vendoredPath } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();
const CC_BY_AUTHOR = "Ada Lovelace";
const CC_BY_LICENCE = "CC-BY-4.0";

interface InlineSlide {
  id: string;
  kind?: string;
  title?: string;
  bullets?: string[];
}

function cli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

function inlineJson(html: string, marker: string, terminator: string): unknown {
  const match = new RegExp(`${marker}=(\\{.*?\\})${terminator}`, "s").exec(html);
  expect(match, `inline JSON for ${marker} missing from deck.html`).not.toBeNull();
  return JSON.parse((match as RegExpExecArray)[1]);
}

function inlineDeck(html: string): { slides: InlineSlide[] } {
  return inlineJson(html, "window\\.__DECK", ";window\\.__DECK_FONT") as { slides: InlineSlide[] };
}

/** Deck with CC0 + generated props, optionally a CC-BY prop, all cached real GLBs. */
function deck(withCcBy: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-e34-"));
  const bytes = new Uint8Array(readFileSync(vendoredPath("cube")));
  const hash = sha256(bytes);
  mkdirSync(join(dir, ".deck3d", "props"), { recursive: true });
  const cache = (key: string): void => writeFileSync(join(dir, ".deck3d", "props", `${key}.glb`), bytes);

  const props: PropOverride[] = [
    { source: "vendored", id: "cube", licence: "CC0-1.0", author: "deck3d corpus", sha256: hash, slide: "intro", role: "illustration", anim: "float" },
    { source: "generated", id: "mascot", licence: "generated", author: "generated", sha256: hash, slide: "intro", role: "illustration", restyle: "palette" },
  ];
  if (withCcBy) {
    props.push({
      source: "poly-pizza",
      id: "robot",
      licence: CC_BY_LICENCE,
      author: CC_BY_AUTHOR,
      sha256: hash,
      slide: "intro",
      role: "illustration",
      restyle: "palette",
    });
  }
  for (const p of props) cache(`${p.source}-${p.id}`);

  const ir = validIR();
  ir.overrides.props = props;
  writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);
  return dir;
}

function render(dir: string): { status: number | null; stderr: string } {
  const r = cli(["render", "deck.json", "-o", "deck.html"], dir);
  return { status: r.status, stderr: r.stderr };
}

describe("E34 licence credits automatic", () => {
  it("CC0 + generated only: no credits slide, in the IR or the HTML", () => {
    const dir = deck(false);
    const r = render(dir);
    expect(r.status, r.stderr).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as { slides: InlineSlide[] };
    expect(onDisk.slides.map((s) => s.id)).not.toContain("credits");
    const slides = inlineDeck(readFileSync(join(dir, "deck.html"), "utf8")).slides;
    expect(slides.map((s) => s.id)).not.toContain("credits");
    expect(slides).toHaveLength(1);
  });

  it("CC-BY present: the last slide is `credits`, listing author and licence", () => {
    const dir = deck(true);
    const r = render(dir);
    expect(r.status, r.stderr).toBe(0);
    const slides = inlineDeck(readFileSync(join(dir, "deck.html"), "utf8")).slides;
    expect(slides).toHaveLength(2);
    const last = slides[slides.length - 1];
    expect(last.id).toBe("credits");
    expect(last.kind).toBe("credits");
    const bullets = (last.bullets ?? []).join("\n");
    expect(bullets).toContain(CC_BY_AUTHOR);
    expect(bullets).toContain(CC_BY_LICENCE);
    // `restyle: palette` is credited as a modification.
    expect(bullets).toContain("modified: restyled");
    // CC0 and generated props owe no attribution.
    expect(bullets).not.toContain("cube");
    expect(bullets).not.toContain("mascot");
  });

  it("the credits slide is absent from deck.json", () => {
    const dir = deck(true);
    expect(render(dir).status).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as { slides: InlineSlide[] };
    expect(onDisk.slides.map((s) => s.id)).not.toContain("credits");
    expect(onDisk.slides).toHaveLength(1);
  });
});

describe.skipIf(!hasChromium)("E34 licence credits automatic (chromium)", () => {
  it("the credits slide is the last slide and a `#2` deep link reaches it", async () => {
    const dir = deck(true);
    const r = render(dir);
    expect(r.status, r.stderr).toBe(0);
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.goto(`file://${join(dir, "deck.html")}#2`);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => window.__deck3d?.current())).toBe(2);
      const slides = await page.evaluate(() => (window.__DECK.slides ?? []).map((s) => s.id));
      expect(slides[slides.length - 1]).toBe("credits");
    } finally {
      await browser.close();
    }
  }, 120_000);
});
