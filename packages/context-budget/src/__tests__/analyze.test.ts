import { describe, expect, it } from "vitest";
import { analyzePayload, checkBudget, comparePayloads } from "../analyze.js";

/** Minimal stand-in for an Anthropic-shaped provider payload. */
function payload(opts: { system?: string; tools?: Array<{ name: string; description: string }> } = {}) {
  return {
    model: "claude-opus-5",
    messages: [{ role: "user", content: "hi" }],
    system: opts.system ?? "You are a helper.",
    tools: opts.tools ?? [],
  };
}

const skillsBlock = (entries: Array<[string, string]>) =>
  `<available_skills>\n${entries
    .map(([name, desc]) => `  <skill>\n    <name>${name}</name>\n    <description>${desc}</description>\n  </skill>`)
    .join("\n")}\n</available_skills>`;

describe("analyzePayload", () => {
  it("accounts for every tool and sums to the tools block size", () => {
    const b = analyzePayload(
      payload({
        tools: [
          { name: "read", description: "Read a file" },
          { name: "bash", description: "Run a command, at some length" },
        ],
      }),
    );

    expect(b.toolCount).toBe(2);
    expect(b.perTool.map((t) => t.name)).toEqual(["bash", "read"]); // sorted by bytes desc
    expect(b.perTool.reduce((sum, t) => sum + t.bytes, 0)).toBeLessThanOrEqual(b.toolsBytes);
    expect(b.toolsBytes).toBeGreaterThan(0);
  });

  it("attributes system-prompt blocks and leaves the remainder as 'other'", () => {
    const system = [
      "Base prompt text.",
      skillsBlock([["alpha", "does alpha things"]]),
      "<project_context>AGENTS content</project_context>",
      "<memory-policy>policy text</memory-policy>",
    ].join("\n");

    const b = analyzePayload(payload({ system }));
    const labels = b.systemBlocks.map((x) => x.label);

    expect(labels).toContain("skills-catalogue");
    expect(labels).toContain("project-context");
    expect(labels).toContain("memory-policy");
    expect(labels).toContain("other");

    const summed = b.systemBlocks.reduce((sum, x) => sum + x.bytes, 0);
    expect(summed).toBe(b.systemBytes);
    expect(b.systemBlocks.every((x) => x.bytes >= 0)).toBe(true);
  });

  it("extracts individual skills with their catalogue cost", () => {
    const b = analyzePayload(
      payload({
        system: skillsBlock([
          ["alpha", "short"],
          ["beta", "a considerably longer description than alpha has"],
        ]),
      }),
    );

    expect(b.skills.map((s) => s.name)).toEqual(["beta", "alpha"]); // fattest first
    expect(b.skills[0].bytes).toBeGreaterThan(b.skills[1].bytes);
  });

  it("handles a payload with no tools and no skills without throwing", () => {
    const b = analyzePayload(payload());
    expect(b.toolCount).toBe(0);
    expect(b.skills).toEqual([]);
    expect(b.payloadBytes).toBeGreaterThan(0);
  });
});

describe("comparePayloads", () => {
  const before = payload({
    system: skillsBlock([
      ["alpha", "aaa"],
      ["beta", "bbb"],
    ]),
    tools: [
      { name: "read", description: "Read a file" },
      { name: "memory_remove", description: "Remove a memory entry, with a long policy blurb" },
    ],
  });

  it("reports removed tools and the bytes reclaimed", () => {
    const after = payload({
      system: skillsBlock([
        ["alpha", "aaa"],
        ["beta", "bbb"],
      ]),
      tools: [{ name: "read", description: "Read a file" }],
    });

    const d = comparePayloads(analyzePayload(before), analyzePayload(after));
    expect(d.toolsRemoved).toEqual(["memory_remove"]);
    expect(d.toolsAdded).toEqual([]);
    expect(d.toolsBytesDelta).toBeLessThan(0);
    expect(d.payloadBytesDelta).toBeLessThan(0);
  });

  it("reports removed skills", () => {
    const after = payload({
      system: skillsBlock([["alpha", "aaa"]]),
      tools: before.tools,
    });

    const d = comparePayloads(analyzePayload(before), analyzePayload(after));
    expect(d.skillsRemoved).toEqual(["beta"]);
    expect(d.systemBytesDelta).toBeLessThan(0);
  });

  // The exact failure this package exists to catch: a config change that looks
  // right, applies cleanly, and changes nothing on the wire.
  it("flags an expected removal that silently did not happen", () => {
    const after = before; // config edit was a no-op
    const d = comparePayloads(analyzePayload(before), analyzePayload(after), {
      expectRemoved: ["memory_remove", "beta"],
    });

    expect(d.payloadBytesDelta).toBe(0);
    expect(d.unmetExpectations).toEqual(["memory_remove", "beta"]);
  });

  it("reports no unmet expectations when the removal did happen", () => {
    const after = payload({
      system: skillsBlock([["alpha", "aaa"]]),
      tools: [{ name: "read", description: "Read a file" }],
    });

    const d = comparePayloads(analyzePayload(before), analyzePayload(after), {
      expectRemoved: ["memory_remove", "beta"],
    });

    expect(d.unmetExpectations).toEqual([]);
  });
});

describe("checkBudget", () => {
  const b = analyzePayload(
    payload({
      system: skillsBlock([["alpha", "x".repeat(500)]]),
      tools: [{ name: "read", description: "y".repeat(500) }],
    }),
  );

  it("passes when every limit is satisfied", () => {
    const r = checkBudget(b, { maxPayloadBytes: 1_000_000, maxToolsBytes: 1_000_000, maxSkillsBytes: 1_000_000 });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("fails and names each exceeded limit", () => {
    const r = checkBudget(b, { maxPayloadBytes: 1, maxToolsBytes: 1, maxSkillsBytes: 1 });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.limit).sort()).toEqual(["maxPayloadBytes", "maxSkillsBytes", "maxToolsBytes"]);
    expect(r.violations.every((v) => v.actual > v.allowed)).toBe(true);
  });

  it("ignores limits that are not configured", () => {
    const r = checkBudget(b, {});
    expect(r.ok).toBe(true);
  });
});
