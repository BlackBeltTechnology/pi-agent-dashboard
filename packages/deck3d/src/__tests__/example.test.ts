import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "./helpers/chromium.js";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;
const EXAMPLES = new URL("../../.pi/skills/deck3d/examples/", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

describe.skipIf(!hasChromium)("worked example (8.2)", () => {
  it("reproduces the committed deck.json from the fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-example-"));
    copyFileSync(join(EXAMPLES, "fixture.md"), join(dir, "fixture.md"));
    copyFileSync(join(EXAMPLES, "deck.json"), join(dir, "deck.json"));

    const r = spawnSync(BIN, ["parse", "fixture.md", "-o", "deck.json"], { cwd: dir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, "deck.json"), "utf8")).toBe(readFileSync(join(EXAMPLES, "deck.json"), "utf8"));
  }, 120_000);

  it("carries the three documented overrides and validates", () => {
    const ir = JSON.parse(readFileSync(join(EXAMPLES, "deck.json"), "utf8"));
    expect(ir.overrides.slides["agens-munkafolyamat"].mode).toBe("light");
    expect(ir.overrides.nodes["agens-munkafolyamat/L"].shape).toBe("diamond");
    expect(ir.overrides.props[0]).toMatchObject({ source: "vendored", id: "brain", role: "node:L" });

    const r = spawnSync(BIN, ["validate", join(EXAMPLES, "deck.json")], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});
