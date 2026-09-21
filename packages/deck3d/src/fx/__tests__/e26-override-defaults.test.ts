/**
 * E26 (task 10.26) — effects: Override replaces defaults.
 *
 * `overrides.slides[id].effects` *replaces* the derived list (arrays replace
 * under the IR merge rule) rather than merging with it, and the override
 * survives a re-parse of edited markdown.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../../ir/merge.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { defaultEffectsFor } from "../defaults.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = "# Seq\n\n```mermaid\nsequenceDiagram\n  A->>B: x\n```\n";
const stubHarvest = async () => ({ diagram: { kind: "sequence" as const, actors: [], messages: [] } });

describe("E26 an effects override replaces the derived defaults", () => {
  it("keeps only the override in the merged list and survives a re-parse", async () => {
    const first = await deriveDeckIR(parseMarkdown(MD), { harvest: stubHarvest, effectsForSlide: defaultEffectsFor });
    const slideId = first.ir.slides[0].id;
    expect(first.ir.slides[0].effects?.map((e) => e.id)).toEqual(["rings", "signal-pulse"]);

    first.ir.overrides.slides = { [slideId]: { effects: [{ id: "aurora" }] } };
    const merged = applyOverrides(first.ir);
    // Arrays replace: `aurora` alone, not `aurora` + the derived defaults.
    expect(merged.slides[0].effects?.map((e) => e.id)).toEqual(["aurora"]);

    const second = await deriveDeckIR(parseMarkdown(`${MD}\n- extra bullet\n`), {
      harvest: stubHarvest,
      effectsForSlide: defaultEffectsFor,
      previous: first.ir,
    });
    expect(second.ir.overrides.slides?.[slideId].effects?.map((e) => e.id)).toEqual(["aurora"]);
    expect(applyOverrides(second.ir).slides[0].effects?.map((e) => e.id)).toEqual(["aurora"]);
  });

  it("CLI re-parse preserves the override in deck.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e26-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- one\n");
    const first = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(first.status, first.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    expect(ir.slides[0].effects.map((e: { id: string }) => e.id)).toEqual(["particles"]);
    ir.overrides.slides = { intro: { effects: [{ id: "aurora" }] } };
    writeFileSync(join(dir, "deck.json"), `${JSON.stringify(ir, null, 2)}\n`);

    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- one\n- two\n");
    const second = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(second.status, second.stderr).toBe(0);
    const reparsed = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8"));
    expect(reparsed.overrides.slides.intro.effects).toEqual([{ id: "aurora" }]);
  });
});
