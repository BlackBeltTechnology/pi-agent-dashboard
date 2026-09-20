/**
 * E9 (task 10.9) — ir: Overrides grammar — arrays replace, objects merge.
 *
 * In-memory `applyOverrides(ir)`: a derived `slides[id].effects=["tokens","fog"]`
 * is replaced wholesale by `["starfield"]`; a derived `camera` object merges with
 * `{distance: 9}`. The persisted derived `slides[]` is never mutated.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../merge.js";
import { validIR } from "./fixtures.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

describe("E9 overrides grammar", () => {
  it("replaces effect arrays, deep-merges camera objects and leaves derived slides untouched", () => {
    const ir = validIR();
    const derived = ir.slides[0];
    derived.camera = { distance: 7 };
    derived.effects = [{ id: "tokens" }, { id: "fog" }];
    ir.overrides.slides = {
      intro: {
        effects: [{ id: "starfield" }],
        camera: { distance: 9 },
      },
    };

    const merged = applyOverrides(ir);

    // Arrays replace exactly — the derived list is not appended to.
    expect(merged.slides[0].effects).toEqual([{ id: "starfield" }]);
    expect(merged.slides[0].effects?.map((e) => e.id)).toEqual(["starfield"]);

    // Objects deep-merge over the derived value.
    expect(merged.slides[0].camera).toEqual({ distance: 9 });

    // The persisted derived slide is unchanged: the merge is a fresh view.
    expect(ir.slides[0].effects?.map((e) => e.id)).toEqual(["tokens", "fog"]);
    expect(ir.slides[0].camera).toEqual({ distance: 7 });
  });
});

/**
 * test-plan #E22 — `overrides apply` is the merge target for the configurator's
 * export. It obeys the same D1 grammar on disk that `applyOverrides` obeys in
 * memory, and a rejected patch must leave `deck.json` byte-unchanged.
 */
describe("E22 overrides apply merge grammar", () => {
  function fixture(): { dir: string; before: string } {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e22-"));
    writeFileSync(join(dir, "talk.md"), "# Geo\n\n- a\n");
    const parsed = spawnSync(BIN, ["parse", "talk.md", "-o", "deck.json"], { cwd: dir, encoding: "utf8" });
    expect(parsed.status, parsed.stderr).toBe(0);

    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown>;
    (deck.overrides as Record<string, unknown>).slides = {
      geo: { mode: "light", diagram: { kind: "bars", data: { labels: ["a", "b"], values: [1, 2] } }, effects: [{ id: "starfield" }] },
    };
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(deck, null, 2)}\n`);
    return { dir, before: readFileSync(join(dir, "deck.json"), "utf8") };
  }

  function apply(dir: string, patch: unknown) {
    writeFileSync(join(dir, "patch.json"), JSON.stringify(patch));
    return spawnSync(BIN, ["overrides", "apply", "deck.json", "patch.json"], { cwd: dir, encoding: "utf8" });
  }

  const slideOverride = (dir: string) =>
    (JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")).overrides.slides.geo ?? {}) as Record<string, unknown>;

  it("deep-merges a scalar into an existing slide override", () => {
    const { dir } = fixture();
    const r = apply(dir, { slides: { geo: { camera: { distance: 11 } } } });
    expect(r.status, r.stderr).toBe(0);
    expect(slideOverride(dir)).toMatchObject({ mode: "light", camera: { distance: 11 } });
  });

  it("replaces an effects array wholesale", () => {
    const { dir } = fixture();
    const r = apply(dir, { slides: { geo: { effects: [{ id: "aurora" }] } } });
    expect(r.status, r.stderr).toBe(0);
    expect(slideOverride(dir).effects).toEqual([{ id: "aurora" }]);
  });

  it("replaces diagram.data wholesale", () => {
    const { dir } = fixture();
    const r = apply(dir, { slides: { geo: { diagram: { data: { labels: ["x"] } } } } });
    expect(r.status, r.stderr).toBe(0);
    expect((slideOverride(dir).diagram as Record<string, unknown>).data).toEqual({ labels: ["x"] });
  });

  it("rejects an invalid patch naming the JSON path and leaves deck.json unchanged", () => {
    const { dir, before } = fixture();
    const r = apply(dir, { deck: { depthRelief: "x" } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("overrides.deck.depthRelief");
    expect(readFileSync(join(dir, "deck.json"), "utf8")).toBe(before);
  });
});
