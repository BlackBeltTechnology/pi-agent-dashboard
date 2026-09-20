/**
 * E22 (task 10.22) — effects: Conflict.
 *
 * `depth-of-field` and `god-rays` declare each other in `conflicts[]`, so a
 * slide enabling both makes `render` fail — naming both ids and the slide —
 * and write no html.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";
import { composeEffects } from "../compose.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const CONFLICTING = [{ id: "depth-of-field" }, { id: "god-rays" }];

describe("E22 conflicting effects fail render", () => {
  it("names both effect ids and the slide, and writes no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e22-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");
    const parse = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
    expect(parse.status, parse.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8"));
    expect(ir.slides[0].id).toBe("arch");
    ir.slides[0].effects = CONFLICTING;
    writeFileSync(join(dir, "arch.json"), `${JSON.stringify(ir, null, 2)}\n`);

    const render = runCli(["render", "arch.json", "-o", "arch.html"], dir);
    expect(render.status, render.stderr).not.toBe(0);
    expect(render.stderr).toContain("depth-of-field");
    expect(render.stderr).toContain("god-rays");
    expect(render.stderr).toContain("arch");
    expect(render.stderr).toMatch(/conflict/i);
    expect(existsSync(join(dir, "arch.html"))).toBe(false);
  }, 120_000);

  it("reports each conflicting pair once in the composition", () => {
    const comp = composeEffects(CONFLICTING, "dark", "high", "arch");
    expect(comp.conflicts).toHaveLength(1);
    expect(comp.conflicts[0]).toContain("depth-of-field");
    expect(comp.conflicts[0]).toContain("god-rays");
    expect(comp.conflicts[0]).toContain("arch");
  });
});

/**
 * test-plan #E12 — a local card declares conflicts like any other card, and
 * the same gate fires: naming the local id, the corpus id and the slide.
 */
describe("E12 local effect conflicts", () => {
  const build = (corpus: string[]) =>
    makeLocalDeck({ effects: [{ name: "x", card: { conflicts: ["aurora"] } }], corpus }, "deck3d-e12-");

  it("fails when the conflicting corpus effect is also present", () => {
    const { dir } = build(["aurora"]);
    const r = runDeckCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("local:x");
    expect(r.stderr).toContain("aurora");
    expect(r.stderr).toContain("geo");
    expect(existsSync(join(dir, "deck.html"))).toBe(false);
  });

  it.each([[[] as string[]], [["starfield"]]])("succeeds without the conflicting id (%j)", (corpus) => {
    const { dir } = build(corpus);
    expect(runDeckCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
  });
});
