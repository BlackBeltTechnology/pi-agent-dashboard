/**
 * X13 (task 10.76) — render: cache miss on props.
 *
 * A placeable prop (`role: illustration` on an existing slide) whose
 * `.deck3d/props/<source>-<id>.glb` cache file is absent must fail `render`
 * before any HTML is written, naming the prop and the fetch remedy
 * (`deck3d props fetch`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync , rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";
import { validIR } from "../../ir/__tests__/fixtures.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe("X13 props cache miss", () => {
  it("fails render naming the prop and the fetch command, and writes no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-x13-"));
    const ir = validIR();
    ir.overrides.props = [
      {
        source: "vendored",
        id: "ghost",
        licence: "CC0-1.0",
        author: "deck3d corpus",
        sha256: "0".repeat(64),
        slide: "intro",
        role: "illustration",
      },
    ];
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);

    const render = runCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(render.status, render.stderr).not.toBe(0);
    expect(render.stderr).toContain("ghost");
    expect(render.stderr).toContain("deck3d props fetch");
    expect(existsSync(join(dir, "deck.html"))).toBe(false);
  });
});

/**
 * test-plan #X13 — `validate` and `render` are separate runs, so a module can
 * vanish between them. `render` re-checks rather than trusting the earlier pass.
 */
describe("X13 local effect file removed after validate", () => {
  it("fails naming the file and writes no html", () => {
    const { dir } = makeLocalDeck({ effects: [{ name: "x" }] }, "deck3d-x13-");
    expect(runDeckCli(["validate", "deck.json"], dir).status).toBe(0);

    rmSync(join(dir, "fx", "x.js"));
    const r = runDeckCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("fx/x.js");
    expect(existsSync(join(dir, "deck.html"))).toBe(false);
  });
});
