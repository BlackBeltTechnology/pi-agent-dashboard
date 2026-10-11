/**
 * Variant loop — change deck3d-pptx-import, test-plan #E48–#E53, #X12.
 * Exemplar: `src/__tests__/cli.test.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { buildLayerDeck } from "../../__tests__/helpers/layer-deck.js";
import { solidPng } from "../../__tests__/helpers/pptx.js";
import { run } from "../../cli.js";
import { PickError, pickVariant } from "../pick.js";
import type { Step, Style } from "../style.js";

const hasChromium = await chromiumAvailable();

async function cli(args: string[]) {
  const err: string[] = [];
  const out: string[] = [];
  const code = await run(args, { stdout: (l) => out.push(l), stderr: (l) => err.push(l) });
  return { code, out: out.join("\n"), stderr: err.join("\n") };
}

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function step(id: string, variants: Step["variants"], over: Partial<Step> = {}): Step {
  return { id, title: id, question: `Which ${id}?`, slides: ["s01"], round: 1, variants, ...over };
}

const v = (name: string, overrides: Record<string, unknown> = {}) => ({ name, label: `Variant ${name}`, overrides });

async function styleDeck(style: Style, slides = ["s01", "s02", "s03", "s04"]) {
  const deck = await buildLayerDeck({ slides: slides.map((id) => ({ id })) });
  writeFileSync(join(deck.dir, "style.json"), `${JSON.stringify(style, null, 2)}\n`);
  return deck;
}

const slideFx = (slide: string, ...effects: unknown[]) => ({ slides: { [slide]: { effects } } });

describe("style.json validation", () => {
  const cases: Array<[string, Step, RegExp]> = [
    ["a step with 1 variant", step("one", [v("A")]), /style\.json steps\[0\]\.variants: needs at least 2/],
    ["a step with 5 variants", step("five", ["A", "B", "C", "D", "E"].map((n) => v(n))), /style\.json steps\[0\]\.variants: allows at most 4/],
    ["duplicate variant names", step("dup", [v("A"), v("A")]), /style\.json steps\[0\]\.variants\[1\]\.name: duplicate variant name 'A'/],
    ["an unknown pick", step("pick", [v("A"), v("B")], { picked: "C" }), /style\.json steps\[0\]\.picked: 'C' names no variant/],
    ["an invalid fragment", step("frag", [v("A", { slides: { s01: { camera: { distance: "far" } } } }), v("B")]), /style\.json steps\[0\]\.variants\[0\]\.overrides\.slides\["s01"\]\.camera\.distance: expected number/],
  ];
  for (const [label, s, pattern] of cases) {
    it(`fails on ${label} (E48)`, async () => {
      const deck = await styleDeck({ version: 1, steps: [s] });
      const r = await cli(["validate", deck.json]);
      expect(r.code, r.stderr).not.toBe(0);
      expect(r.stderr).toMatch(pattern);
    }, 60_000);
  }

  it("only warns about a sample slide the deck no longer has, and exits 0 (E48)", async () => {
    const deck = await styleDeck({ version: 1, steps: [step("placement", [v("A"), v("B")], { slides: ["s01", "s09"] })] });
    const r = await cli(["validate", deck.json]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/warn style\.json steps\[0\]\.slides: sample slide 's09'/);
  }, 60_000);
});

describe.skipIf(!hasChromium)("variants render (chromium)", () => {
  it("writes a 2×4 contact sheet without touching deck.json or leaving temp HTML (E49)", async () => {
    const style: Style = {
      version: 1,
      steps: [
        step("placement", [v("A", { deck: { mode: "light" } }), v("B", { deck: { mode: "dark" } }), v("C", { deck: { palette: "neon" } })], {
          slides: ["s02", "s04", "s99"],
        }),
      ],
    };
    const deck = await styleDeck(style);
    mkdirSync(join(deck.dir, "pptx", "ref"), { recursive: true });
    for (const id of ["s02", "s04"]) writeFileSync(join(deck.dir, "pptx", "ref", `${id}.png`), solidPng(64, 36, [30, 30, 30, 255]));
    const before = sha(deck.json);
    const stray = () => readdirSync(tmpdir()).filter((n) => n.startsWith("deck3d-variants-"));
    const strayBefore = stray();
    const r = await cli(["variants", "render", "--step", "placement", "--deck", deck.json, "-o", deck.dir]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/warning .*'s99'/);
    expect(sha(deck.json)).toBe(before);
    const contact = join(deck.dir, "variants", "placement", "r1", "contact.png");
    const head = readFileSync(contact);
    // 4 columns (reference + A, B, C) × 480 px; a 32 px header + 2 rows × 270 px.
    expect([head.readUInt32BE(16), head.readUInt32BE(20)]).toEqual([4 * 480, 32 + 2 * 270]);
    for (const f of ["A-s02", "B-s02", "C-s04"]) expect(existsSync(join(deck.dir, "variants", "placement", "r1", `${f}.png`)), f).toBe(true);
    expect(existsSync(join(deck.dir, "variants", "placement", "r1", "A-s99.png"))).toBe(false);
    expect(stray()).toEqual(strayBefore);
  }, 240_000);
});

describe("variants pick / note / replay", () => {
  it("rejects an out-of-range param naming it, leaving both files byte-unchanged (E50)", async () => {
    const bad = slideFx("s01", { id: "slide-layer", params: { layout: "lay", slide: "s01", halo: 5 } });
    const deck = await styleDeck({ version: 1, steps: [step("placement", [v("A", bad), v("B")])] });
    const d = readFileSync(deck.json);
    const s = readFileSync(join(deck.dir, "style.json"));
    const r = await cli(["variants", "pick", "placement", "A", "--deck", deck.json]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["s01"].effects[0].params.halo');
    expect(readFileSync(deck.json).equals(d)).toBe(true);
    expect(readFileSync(join(deck.dir, "style.json")).equals(s)).toBe(true);
  }, 60_000);

  it("refuses to drop earlier-step or configurator effects without --drop / --replace-step (E51)", async () => {
    const layer = { id: "slide-layer", params: { layout: "lay", slide: "s04" } };
    const style: Style = {
      version: 1,
      steps: [step("placement", [v("A", slideFx("s04", layer)), v("B")], { slides: ["s04"] }), step("worlds", [v("A", slideFx("s04", { id: "fog" })), v("B")], { slides: ["s04"] })],
    };
    const deck = await styleDeck(style);
    const placed = await cli(["variants", "pick", "placement", "A", "--deck", deck.json]);
    expect(placed.code, placed.stderr).toBe(0);
    // The configurator adds god-rays to the same slide.
    const d = JSON.parse(readFileSync(deck.json, "utf8"));
    d.overrides.slides.s04.effects.push({ id: "god-rays" });
    writeFileSync(deck.json, `${JSON.stringify(d, null, 2)}\n`);

    const first = await cli(["variants", "pick", "worlds", "A", "--deck", deck.json]);
    expect(first.code).not.toBe(0);
    expect(first.stderr).toMatch(/overrides\.slides\["s04"\]\.effects/);
    expect(first.stderr).toMatch(/'god-rays'/);
    expect(first.stderr).toMatch(/'slide-layer' \(added by step placement\)/);

    const second = await cli(["variants", "pick", "worlds", "A", "--deck", deck.json, "--drop", "god-rays"]);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toMatch(/'slide-layer' \(added by step placement\)/);
    expect(second.stderr).not.toMatch(/would remove 'god-rays'/);

    const third = await cli(["variants", "pick", "worlds", "A", "--deck", deck.json, "--drop", "god-rays", "--replace-step", "placement"]);
    expect(third.code, third.stderr).toBe(0);
    const after = JSON.parse(readFileSync(deck.json, "utf8"));
    expect(after.overrides.slides.s04.effects.map((e: { id: string }) => e.id)).toEqual(["fog"]);
  }, 120_000);

  it("records a free-text answer: picked null, the note, and a new round (E52)", async () => {
    const deck = await styleDeck({ version: 1, steps: [step("placement", [v("A"), v("B")])] });
    const r = await cli(["variants", "note", "placement", "--note", "like B without glass", "--deck", deck.json]);
    expect(r.code, r.stderr).toBe(0);
    const st = JSON.parse(readFileSync(join(deck.dir, "style.json"), "utf8")) as Style;
    expect(st.steps[0].picked).toBeNull();
    expect(st.steps[0].note).toBe("like B without glass");
    expect(st.steps[0].round).toBe(2);
  }, 60_000);

  it("replays idempotently and reports a pick whose slide is gone (E53)", async () => {
    const style: Style = {
      version: 1,
      steps: [
        step("a", [v("A", { deck: { mode: "light" } }), v("B")]),
        step("b", [v("A", slideFx("s02", { id: "fog" })), v("B")]),
        step("c", [v("A", slideFx("s03", { id: "vignette" })), v("B")]),
      ],
    };
    const deck = await styleDeck(style);
    for (const id of ["a", "b", "c"]) expect((await cli(["variants", "pick", id, "A", "--deck", deck.json])).code).toBe(0);
    const before = readFileSync(deck.json);
    const r = await cli(["variants", "replay", "--deck", deck.json]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatch(/unchanged/);
    expect(readFileSync(deck.json).equals(before)).toBe(true);

    const d = JSON.parse(readFileSync(deck.json, "utf8"));
    d.slides = d.slides.filter((s: { id: string }) => s.id !== "s03");
    writeFileSync(deck.json, `${JSON.stringify(d, null, 2)}\n`);
    const gone = await cli(["variants", "replay", "--deck", deck.json]);
    expect(gone.code, gone.stderr).toBe(0);
    expect(gone.stderr).toMatch(/step c: overrides\.slides\["s03"\] references a slide missing/);
  }, 120_000);

  it("replays two picks that replace the same slide's effects (B5)", async () => {
    // `b` carries `a`'s effect forward (arrays replace) and adds its own to the SAME list.
    const style: Style = {
      version: 1,
      steps: [
        step("a", [v("A", slideFx("s02", { id: "fog" })), v("B")]),
        step("b", [v("A", slideFx("s02", { id: "fog" }, { id: "vignette" })), v("B")]),
      ],
    };
    const deck = await styleDeck(style);
    for (const id of ["a", "b"]) expect((await cli(["variants", "pick", id, "A", "--deck", deck.json])).code, id).toBe(0);
    const before = readFileSync(deck.json);
    const r = await cli(["variants", "replay", "--deck", deck.json]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatch(/unchanged/);
    expect(readFileSync(deck.json).equals(before)).toBe(true);
    const effects = JSON.parse(before.toString()).overrides.slides.s02.effects.map((e: { id: string }) => e.id);
    expect(effects).toEqual(["fog", "vignette"]);
  }, 120_000);

  it("serialises writers with a lock: a held lock refuses, a stale one is cleared, errors release it (B6)", async () => {
    const bad = slideFx("s01", { id: "slide-layer", params: { layout: "lay", slide: "s01", halo: 5 } });
    const deck = await styleDeck({ version: 1, steps: [step("placement", [v("A", { deck: { mode: "light" } }), v("B", bad)])] });
    const lock = join(deck.dir, "style.json.lock");
    const before = [readFileSync(deck.json), readFileSync(join(deck.dir, "style.json"))];

    // Held by a live process (this one): refuse without touching anything.
    writeFileSync(lock, String(process.pid));
    const held = await cli(["variants", "pick", "placement", "A", "--deck", deck.json]);
    expect(held.code).not.toBe(0);
    expect(held.stderr).toMatch(/another variants command is running/);
    expect(readFileSync(deck.json).equals(before[0])).toBe(true);
    expect(readFileSync(join(deck.dir, "style.json")).equals(before[1])).toBe(true);
    expect(existsSync(lock), "a lock we did not take is never removed").toBe(true);

    // Left behind by a process that is gone: cleared, the pick proceeds, the lock is released.
    writeFileSync(lock, "999999");
    const stale = await cli(["variants", "pick", "placement", "A", "--deck", deck.json]);
    expect(stale.code, stale.stderr).toBe(0);
    expect(existsSync(lock)).toBe(false);

    // A pick that FAILS validation releases the lock too.
    const failed = await cli(["variants", "pick", "placement", "B", "--deck", deck.json]);
    expect(failed.code).not.toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect((await cli(["variants", "note", "placement", "--note", "after", "--deck", deck.json])).code).toBe(0);
  }, 120_000);

  it("keeps deck.json and style.json consistent when two processes pick at once (B6)", async () => {
    const { spawn } = await import("node:child_process");
    const bin = new URL("../../../bin/deck3d", import.meta.url).pathname;
    const style: Style = { version: 1, steps: [step("look", [v("A", { deck: { mode: "light" } }), v("B", { deck: { mode: "dark" } })])] };
    for (let round = 0; round < 3; round++) {
      const deck = await styleDeck(style);
      const run = (name: string) =>
        new Promise<number>((resolve) => {
          const p = spawn(bin, ["variants", "pick", "look", name, "--deck", deck.json], { stdio: "ignore" });
          p.on("exit", (c) => resolve(c ?? 1));
        });
      await Promise.all([run("A"), run("B")]);
      const st = JSON.parse(readFileSync(join(deck.dir, "style.json"), "utf8")) as Style;
      const picked = st.steps[0].picked;
      const mode = JSON.parse(readFileSync(deck.json, "utf8")).overrides.deck?.mode;
      expect(st.steps[0].pending, `round ${round}`).toBe(false);
      expect(mode, `round ${round}: the deck holds the variant style.json says was picked`).toBe(picked === "A" ? "light" : "dark");
      expect(existsSync(join(deck.dir, "style.json.lock")), `round ${round}`).toBe(false);
      expect(readdirSync(deck.dir).filter((n) => n.includes(".tmp-")), `round ${round}: no stray temp files`).toEqual([]);
    }
  }, 180_000);

  it("reports an interrupted pick naming the step and asks for a re-run (X12)", async () => {
    const deck = await styleDeck({ version: 1, steps: [step("placement", [v("A", { deck: { mode: "light" } }), v("B")])] });
    expect(() =>
      pickVariant({
        deckJson: deck.json,
        step: "placement",
        name: "A",
        hooks: {
          afterWrite: (phase) => {
            if (phase === "deck") throw new Error("crash after deck.json");
          },
        },
      }),
    ).toThrow(/crash/);
    const st = JSON.parse(readFileSync(join(deck.dir, "style.json"), "utf8")) as Style;
    expect(st.steps[0].pending).toBe(true);
    for (const args of [["variants", "render", "--step", "placement"], ["variants", "replay"], ["variants", "note", "placement", "--note", "x"]]) {
      const r = await cli([...args, "--deck", deck.json]);
      expect(r.code, args.join(" ")).not.toBe(0);
      expect(r.stderr, args.join(" ")).toMatch(/step 'placement' was interrupted.*re-run: deck3d variants pick placement A/);
    }
    // The re-run the message asks for completes the pick.
    expect(() => pickVariant({ deckJson: deck.json, step: "placement", name: "A" })).not.toThrow();
    const done = JSON.parse(readFileSync(join(deck.dir, "style.json"), "utf8")) as Style;
    expect(done.steps[0].pending).toBe(false);
    expect(done.steps[0].picked).toBe("A");
    expect(PickError).toBeDefined();
  }, 120_000);
});
