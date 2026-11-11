/**
 * E5 canary: pins the wording of the workspace-installed pi's default `docs`
 * section against the phrases the Claude subscription compat rewrite targets.
 * A pi release that rewords or moves them fails here, in CI.
 *
 * pi 1.5.0 ("Tightened system prompt") no longer renders "pi itself" / "pi
 * packages": the block now reads "…about the harness itself, its SDK, …". The
 * canary pins that: the block is still anchored once, neither phrase is present,
 * and both compat rewrites are therefore no-ops on the real prompt. A pi release
 * that brings a flagged phrase back fails here again.
 * See change: update-pi-core-1-5-adopt-apis.
 *
 * Imports pi's internal `dist/core/system-prompt.js` by file path (it is not a
 * public export); a moved file fails this test loudly, which is intended.
 * See change: retire-anthropic-messages-bridge (test-plan #E5).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeCompatExtension, rewritePayloadSystem } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/claude-compat.js";

// The package exports only an ESM "." entry, so resolve it the way Node does:
// walk up node_modules from this file to the installed package root.
function findPiRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "node_modules", "@earendil-works", "pi-coding-agent");
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("@earendil-works/pi-coding-agent not installed");
    dir = parent;
  }
}
const piRoot = findPiRoot();
const { buildSystemPrompt } = (await import(
  pathToFileURL(path.join(piRoot, "dist/core/system-prompt.js")).href
)) as { buildSystemPrompt: (input: Record<string, unknown>) => string };

const DOCS_BLOCK_RE = /<docs>\nPi documentation \([\s\S]*?\n<\/docs>/g;

describe("pi default prompt docs canary (E5)", () => {
  const prompt = buildSystemPrompt({ cwd: "/repo", selectedTools: ["read", "bash"] });

  it("has exactly one anchored docs block, and pi 1.5 renders neither flagged phrase", () => {
    const blocks = [...prompt.matchAll(DOCS_BLOCK_RE)].map((m) => m[0]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).not.toContain("pi itself");
    expect(blocks[0]).not.toContain("pi packages");
    expect(blocks[0]).toContain("the harness itself");
    expect(blocks[0]).toMatch(/^<docs>\nPi documentation \(read only when the user asks about the harness itself/);
  });

  it("the compat rewrite is a no-op on the real rendered prompt (nothing to rewrite)", () => {
    let handler: ((e: unknown, c: unknown) => unknown) | undefined;
    claudeCompatExtension(() => true)({ on: (n, h) => { if (n === "before_agent_start") handler = h; } });
    expect(typeof handler).toBe("function");
    const opts: { sections?: Record<string, string> } = {};
    handler?.({ systemPrompt: prompt, systemPromptOptions: opts }, { model: { provider: "anthropic" } });
    // Nothing to rewrite → no section override is written at all.
    expect(opts).toEqual({});
  });

  // See change: seed-claude-compat-on-upgrade (test-plan #P1).
  it("the payload rewrite is a no-op on the real rendered prompt as Anthropic `system`", () => {
    const out = rewritePayloadSystem({ system: [{ type: "text", text: prompt }], messages: [] });
    expect(out).toBe(undefined);
    expect(prompt).not.toContain("pi itself");
    expect(prompt).not.toContain("pi packages");
  });
});
