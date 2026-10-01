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

/**
 * test-plan #E33 — the v1 precedence is a strict PREFIX of the new one. Any
 * slide v1 gave a real answer for must keep that answer; only slides that fell
 * through to `particles` are allowed to move. Checked against the shipped
 * fixture rather than hand-written slides.
 */

/** The v1 `defaultEffectsFor`, frozen here as the reference implementation. */
function v1DefaultEffectsFor(slide: { id: string; title: string; bullets: string[]; diagram: { kind: string } }): string[] {
  const KEYWORDS: Array<{ re: RegExp; background: string }> = [
    { re: /security|biztons|auth|secur/i, background: "glyph-rain" },
    { re: /data|adat|metric|observab|telemetr/i, background: "data-columns" },
  ];
  const BY_DIAGRAM: Record<string, { background: string; edge?: string }> = {
    flowchart: { background: "tokens", edge: "signal-pulse" },
    sequence: { background: "rings", edge: "signal-pulse" },
    brain: { background: "particles" },
    loop: { background: "rings" },
    swarm: { background: "swarm" },
  };
  const text = `${slide.title} ${slide.bullets.join(" ")}`;
  const byKind = BY_DIAGRAM[slide.diagram.kind] ?? { background: "particles" };
  const keyword = KEYWORDS.find((k) => k.re.test(text));
  const isTitleish = slide.diagram.kind === "none" && slide.bullets.length === 0 && !slide.id.includes("-");
  const background = keyword?.background ?? (isTitleish ? "swarm" : byKind.background);
  return byKind.edge ? [background, byKind.edge] : [background];
}

describe("E33 v1 defaults are a strict prefix of the new ones", () => {
  it("changes only the strategy-lab slides that resolved to particles under v1", async () => {
    const source = readFileSync(new URL("../../../fixtures/strategy-lab.md", import.meta.url), "utf8");
    const { ir } = await deriveDeckIR(parseMarkdown(source), { harvest: stubHarvest, effectsForSlide: defaultEffectsFor });
    expect(ir.slides.length).toBeGreaterThan(0);

    let moved = 0;
    for (const slide of ir.slides) {
      // v1 `parse` could only ever emit `flowchart`/`sequence`/`none`, so the
      // reference is evaluated against the kind v1 would have derived.
      const v1Kind = slide.diagram.kind === "flowchart" || slide.diagram.kind === "sequence" ? slide.diagram.kind : "none";
      const old = v1DefaultEffectsFor({ ...slide, diagram: { kind: v1Kind } });
      const now = (slide.effects ?? []).map((e) => e.id);
      if (old[0] === "particles") {
        moved += now[0] === "particles" ? 0 : 1;
        continue;
      }
      expect(now, `slide ${slide.id}`).toEqual(old);
    }
    // The whole point of D3: at least one previously-generic slide got scenery.
    expect(moved).toBeGreaterThan(0);
  });
});
