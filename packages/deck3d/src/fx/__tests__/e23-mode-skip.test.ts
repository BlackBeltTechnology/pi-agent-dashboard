/**
 * E23 (task 10.23) — effects: Mode-incompatible skipped.
 *
 * `glyph-rain` declares `modes: "dark"`; a `mode:light` slide skips it with
 * `warn skipped <id> (dark only) slide <sid>` and keeps rendering (exit 0).
 * The skipped entry never reaches the runtime's active list.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeEffects } from "../compose.js";
import { REGISTRY } from "../index.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe("E23 mode-incompatible effects are skipped", () => {
  it("uses a card that really is dark-only", () => {
    expect(REGISTRY["glyph-rain"].card.modes).toBe("dark");
  });

  it("render warns, exits 0, writes the html and keeps the light effects", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e23-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");
    const parse = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
    expect(parse.status, parse.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8"));
    expect(ir.slides[0].id).toBe("arch");
    ir.slides[0].effects = [{ id: "glyph-rain" }, { id: "bloom" }];
    ir.overrides.slides = { arch: { mode: "light" } };
    writeFileSync(join(dir, "arch.json"), `${JSON.stringify(ir, null, 2)}\n`);

    const render = runCli(["render", "arch.json", "-o", "arch.html"], dir);
    expect(render.status, render.stderr).toBe(0);
    expect(render.stderr).toContain("warn skipped glyph-rain (dark only) slide arch");
    expect(existsSync(join(dir, "arch.html"))).toBe(true);
  }, 120_000);

  it("drops the skipped effect from the active runtime list", () => {
    const comp = composeEffects([{ id: "glyph-rain" }, { id: "bloom" }], "light", "high", "arch");
    expect(comp.active.map((e) => e.id)).toEqual(["bloom"]);
    expect(comp.skipped).toEqual([{ id: "glyph-rain", reason: "dark only" }]);
    expect(comp.warnings).toContain("warn skipped glyph-rain (dark only) slide arch");
  });
});
