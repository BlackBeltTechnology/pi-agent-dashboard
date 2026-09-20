/**
 * E5 (task 10.5) — ir: Overrides survive re-parse.
 *
 * A target carries `overrides.nodes["arch/A"].shape="hexagon"`; the markdown is
 * then edited so slide `arch` gains one bullet. Re-parse regenerates the derived
 * bullets (+1) and reapplies the override unchanged, exit 0.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../merge.js";
import type { DeckIR } from "../types.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

interface DeckJson {
  slides: Array<{ id: string; bullets: string[]; diagram: { kind: string } }>;
  overrides: {
    nodes?: Record<string, { shape?: string }>;
    slides?: Record<string, { diagram?: { kind?: string } }>;
  };
}

describe("E5 overrides survive re-parse", () => {
  it("regenerates the derived bullets and reapplies the node override", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e5-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");

    const first = runCli(["parse", "arch.md", "-o", "target.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const targetPath = join(dir, "target.json");
    const before = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    expect(before.slides[0].bullets).toHaveLength(1);

    // Author a node override into the target.
    before.overrides.nodes = { "arch/A": { shape: "hexagon" } };
    writeFileSync(targetPath, JSON.stringify(before, null, 2));

    // Edit the markdown: slide `arch` gains one bullet.
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n- two\n");
    const second = runCli(["parse", "arch.md", "-o", "target.json"], dir);
    expect(second.status, second.stderr).toBe(0);

    const after = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    const slide = after.slides.find((s) => s.id === "arch");
    expect(slide?.bullets).toEqual(["one", "two"]);
    expect(after.overrides.nodes?.["arch/A"].shape).toBe("hexagon");
  });
});

/**
 * The markdown is the source of truth for diagram STRUCTURE (D1). A built-kind
 * override is therefore kept but inert once the slide grows a real mermaid
 * block — the agent must be told, not silently overruled.
 */
describe("E20/E21 built-kind override vs a mermaid block", () => {
  function seed(mermaid: string, kind: string): { dir: string; deck: DeckJson; warn: string } {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e20-"));
    writeFileSync(join(dir, "flow.md"), "# Flow\n\n- one\n");
    expect(runCli(["parse", "flow.md", "-o", "deck.json"], dir).status).toBe(0);

    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as DeckJson;
    deck.overrides.slides = { flow: { diagram: { kind } } };
    writeFileSync(join(dir, "deck.json"), JSON.stringify(deck, null, 2));

    writeFileSync(join(dir, "flow.md"), `# Flow\n\n- one\n\n${mermaid}\n`);
    const second = runCli(["parse", "flow.md", "-o", "deck.json"], dir);
    expect(second.status, second.stderr).toBe(0);
    return { dir, deck: JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as DeckJson, warn: second.stderr };
  }

  // test-plan #E20
  it("lets a supported flowchart win, keeps the override, and warns it is ignored", () => {
    const { deck, warn } = seed("```mermaid\nflowchart LR\n  A --> B\n```", "brain");
    expect(deck.slides[0].diagram.kind).toBe("flowchart");
    expect(deck.overrides.slides?.flow?.diagram?.kind).toBe("brain");
    expect(warn).toContain('overrides.slides["flow"].diagram.kind');
    expect(warn).toContain("ignored");
  });

  // test-plan #E21 — an unsupported fence yields no diagram, so the override is live.
  it("honours the override under an unsupported fence and does not call it ignored", () => {
    const { deck, warn } = seed('```mermaid\npie title X\n  "a" : 1\n```', "bars");
    // The markdown contributed no diagram, so the built-kind override survives
    // into the merged view the renderer consumes.
    expect(deck.slides[0].diagram.kind).toBe("none");
    expect(applyOverrides(deck as unknown as DeckIR).slides[0].diagram.kind).toBe("bars");
    expect(warn.toLowerCase()).toMatch(/unsupported/);
    expect(warn).not.toContain("ignored");
  });
});
