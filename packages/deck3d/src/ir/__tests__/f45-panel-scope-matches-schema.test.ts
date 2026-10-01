/**
 * The panel may only offer what the IR can persist, per scope.
 *
 * The configurator drifted from the schema: 16 look knobs were offered at
 * slide scope and applied live, but `overrides.slides[id]` rejected every one
 * of them, so exporting produced a deck that would not render. That drift was
 * invisible because nothing compared the two lists.
 *
 * This test is the comparison. A control added to a scope the schema does not
 * allow fails here rather than at someone's export.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../schema.json", import.meta.url)), "utf8"));
const hud = readFileSync(fileURLToPath(new URL("../../runtime/hud.ts", import.meta.url)), "utf8");

const deckKeys = new Set(Object.keys(schema.definitions.defaults.properties));
const slideKeys = new Set(Object.keys(schema.definitions.overrides.properties.slides.additionalProperties.properties));

/** Panel-only concepts: no IR key behind them. */
const PANEL_ONLY = new Set(["autoplay", "effects"]);

/** Root keys mentioned in a fragment of control-spec source. */
function rootsIn(source: string): string[] {
  return [...source.matchAll(/(?:C\(|path:\s*)"([a-zA-Z.]+)"/g)].map((m) => m[1].split(".")[0]);
}

/** `const LOOK: ControlSpec[] = [...]` — blocks reference these by name. */
const NAMED: Record<string, string[]> = Object.fromEntries(
  [...hud.matchAll(/const ([A-Z_]+): ControlSpec\[\] = \[([\s\S]*?)\n\];/g)].map((m) => [m[1], rootsIn(m[2])]),
);

/** Control paths of one scope, as the BLOCKS table declares them. */
function controlsOf(scope: "deck" | "slide"): string[] {
  const blocks = hud.slice(hud.indexOf("const BLOCKS"), hud.indexOf("export const AUTOPLAY_MIN"));
  const paths: string[] = [];
  // A scope is either an inline array or a reference to a NAMED list.
  for (const match of blocks.matchAll(new RegExp(`${scope}:\\s*(\\[[\\s\\S]*?\\]|[A-Z_]+)`, "g"))) {
    const value = match[1];
    if (value.startsWith("[")) paths.push(...rootsIn(value));
    else paths.push(...(NAMED[value] ?? []));
  }
  return [...new Set(paths)];
}

describe("F45 panel scope matches the schema", () => {
  it("every slide-scope control is a key the IR accepts per slide", () => {
    const offenders = controlsOf("slide").filter((p) => !PANEL_ONLY.has(p) && !slideKeys.has(p));
    expect(offenders, "offered at slide scope but rejected by overrides.slides[id]").toEqual([]);
  });

  it("every deck-scope control is a key the IR accepts on the deck", () => {
    const offenders = controlsOf("deck").filter((p) => !PANEL_ONLY.has(p) && !deckKeys.has(p));
    expect(offenders, "offered at deck scope but rejected by defaults/overrides.deck").toEqual([]);
  });

  it("rail and spacing stay deck-only — they position every anchor", () => {
    expect(slideKeys.has("rail")).toBe(false);
    expect(slideKeys.has("spacing")).toBe(false);
    expect(controlsOf("slide")).not.toContain("rail");
    expect(controlsOf("slide")).not.toContain("spacing");
  });

  it("reads a non-empty control list (the parser itself must not silently fail)", () => {
    expect(Object.keys(NAMED).length, "named ControlSpec lists must resolve").toBeGreaterThan(0);
    expect(controlsOf("deck").length).toBeGreaterThan(10);
    expect(controlsOf("slide").length).toBeGreaterThan(10);
    // The knobs this whole change is about must be seen by the parser.
    expect(controlsOf("slide")).toContain("fog");
    expect(controlsOf("slide")).toContain("floorMatte");
  });
});
