/**
 * E25 (task 10.25) — effects: Deterministic defaults.
 *
 * `parse` assigns the same `slides[].effects` list for the same content: a
 * title-only slide gets `swarm`, a flowchart `tokens` + `signal-pulse`, a
 * sequence `rings` + `signal-pulse`, and a security keyword `glyph-rain`.
 * Two runs are identical.
 *
 * The mermaid harvest is injected (the same seam `cli.ts:parseToFile` uses), so
 * the suite is browser-free and still exercises the real `parse` path.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { defaultEffectsFor } from "../defaults.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Intro

# Arch

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

# Seq

\`\`\`mermaid
sequenceDiagram
  A->>B: x
\`\`\`

# Security hardening
`;

/** Stub harvester: only the diagram *kind* matters for default effects. */
const stubHarvest = async (source: string) =>
  source.includes("sequenceDiagram")
    ? { diagram: { kind: "sequence" as const, actors: [], messages: [] } }
    : { diagram: { kind: "flowchart" as const, dir: "LR" as const, nodes: [], edges: [], groups: [] } };

async function parseFixture() {
  return deriveDeckIR(parseMarkdown(MD), { harvest: stubHarvest, effectsForSlide: defaultEffectsFor });
}

describe("E25 deterministic defaults from content", () => {
  it("maps title / flowchart / sequence / keyword to the table rows", async () => {
    const { ir, warnings } = await parseFixture();
    expect(warnings).toEqual([]);
    expect(ir.slides.map((s) => ({ id: s.id, effects: s.effects?.map((e) => e.id) }))).toEqual([
      { id: "intro", effects: ["swarm"] },
      { id: "arch", effects: ["tokens", "signal-pulse"] },
      { id: "seq", effects: ["rings", "signal-pulse"] },
      { id: "security-hardening", effects: ["glyph-rain"] },
    ]);
  });

  it("is identical across two runs", async () => {
    const a = await parseFixture();
    const b = await parseFixture();
    expect(JSON.stringify(a.ir.slides)).toBe(JSON.stringify(b.ir.slides));
  });

  it("CLI parse is byte-identical across two runs (browser-free deck)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e25-"));
    const md = "# Intro\n\n# Security hardening\n\n- audit\n";
    writeFileSync(join(dir, "talk.md"), md);
    const first = runCli(["parse", "talk.md", "-o", "a.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const second = runCli(["parse", "talk.md", "-o", "b.json"], dir);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(dir, "a.json"), "utf8")).toBe(readFileSync(join(dir, "b.json"), "utf8"));
    const ir = JSON.parse(readFileSync(join(dir, "a.json"), "utf8"));
    expect(ir.slides.map((s: { effects: Array<{ id: string }> }) => s.effects.map((e) => e.id))).toEqual([
      ["swarm"],
      ["glyph-rain"],
    ]);
  });
});
