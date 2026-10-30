/**
 * E5 canary: the workspace-installed pi still renders its default `docs`
 * section with both phrases the Claude subscription compat rewrite targets.
 * A pi release that rewords or moves them fails here, in CI, instead of
 * silently billing users as extra usage.
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

  it("has exactly one anchored docs block containing both flagged phrases", () => {
    const blocks = [...prompt.matchAll(DOCS_BLOCK_RE)].map((m) => m[0]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("pi itself");
    expect(blocks[0]).toContain("pi packages");
  });

  it("the compat rewrite applies to the real rendered prompt", () => {
    let handler: ((e: unknown, c: unknown) => unknown) | undefined;
    claudeCompatExtension(() => true)({ on: (n, h) => { if (n === "before_agent_start") handler = h; } });
    const opts: { sections?: Record<string, string> } = {};
    handler?.({ systemPrompt: prompt, systemPromptOptions: opts }, { model: { provider: "anthropic" } });
    expect(opts.sections?.docs).toBeDefined();
    expect(opts.sections?.docs).not.toContain("pi itself");
    expect(opts.sections?.docs).not.toContain("pi packages");
  });

  // See change: seed-claude-compat-on-upgrade (test-plan #P1).
  it("the payload rewrite applies to the real rendered prompt as Anthropic `system`", () => {
    const out = rewritePayloadSystem({ system: [{ type: "text", text: prompt }], messages: [] }) as
      | { system: Array<{ text: string }> }
      | undefined;
    expect(out).toBeDefined();
    expect(out!.system[0]!.text).not.toContain("pi itself");
    expect(out!.system[0]!.text).not.toContain("pi packages");
    expect(out!.system[0]!.text).toContain("the cli itself");
  });
});
