/**
 * E14 — harvest: node ids stable / edge ids with underscores (#E14, 10.14).
 *
 * Observable: node ids `L_A` / `B_C` survive verbatim; the edge
 * `{from:"L_A", to:"B_C"}` appears exactly once and the whole deck.json is
 * identical across two parses.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagram } from "../../../ir/types.js";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MERMAID = ["flowchart TD", "  L_A[Left] --> B_C[Right]"].join("\n");

function parseTo(dir: string, out: string): string {
  const r = spawnSync(BIN, ["parse", "ids.md", "-o", out], { cwd: dir, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(join(dir, out), "utf8");
}

describe.skipIf(!hasChromium)("harvest: node ids stable / edge ids with underscores (E14)", () => {
  it("keeps underscore ids, emits the edge exactly once and is stable across runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-harvest-e14-"));
    writeFileSync(join(dir, "ids.md"), `# Underscores\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);

    const first = parseTo(dir, "a.json");
    const second = parseTo(dir, "b.json");
    expect(second).toBe(first);

    const diagram = (JSON.parse(first) as { slides: Array<{ diagram: Diagram }> }).slides[0].diagram;
    expect((diagram.nodes ?? []).map((n) => n.id)).toEqual(["L_A", "B_C"]);

    const matching = (diagram.edges ?? []).filter((e) => e.from === "L_A" && e.to === "B_C");
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ from: "L_A", to: "B_C" });
    // The edge id itself keeps both underscores, no folding to `L_A-B_C`.
    expect(matching[0].id).toBe("L_A->B_C#0");
  }, 120_000);
});
