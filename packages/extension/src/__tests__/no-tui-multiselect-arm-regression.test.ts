/**
 * Repo-level invariant: `packages/extension/src/bridge.ts` MUST NOT
 * contain the co-occurrence of two substrings:
 *
 *   1. `originals.custom`
 *   2. `prompt.type === "multiselect"`
 *
 * If both appear in the same file, a contributor has (re)introduced the
 * TUI PromptBus-adapter multiselect arm that was removed by change
 * `fix-multiselect-tui-arm-self-cancel`. The arm is forbidden because
 * pi 0.70's RPC mode (the only mode dashboard headless sessions run
 * under) defines `ExtensionUIContext.custom` as an unconditional no-op
 * (`async custom() { return undefined; }`, see
 * `~/.nvm/.../@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js`
 * lines 150-153). Awaiting that primitive resolves to `undefined`
 * synchronously, and the TUI arm's `bus.respond({ cancelled: true,
 * source: "tui" })` triggers the PromptBus's first-response-wins
 * dismissal — which auto-cancels the dashboard's already-rendered
 * `MultiselectRenderer` within ~1 event-loop tick.
 *
 * The bus-routed `(ctx.ui as any).multiselect = (...) => bus.request(...)`
 * patch site uses the substring `type: "multiselect"` (object-literal
 * shape), not `prompt.type === "multiselect"` (equality-check shape),
 * so it is unaffected by this lint.
 *
 * To remove a legitimate `originals.custom` reference (e.g. for a
 * future use that does not include multiselect prompt routing), keep
 * one substring and ensure the other does not co-occur.
 *
 * See change: fix-multiselect-tui-arm-self-cancel.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const FORBIDDEN_A = "originals.custom";
const FORBIDDEN_B = 'prompt.type === "multiselect"';

function findLineNumbers(src: string, needle: string): number[] {
  const lines = src.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, idx) => {
    if (line.includes(needle)) hits.push(idx + 1);
  });
  return hits;
}

describe("no TUI multiselect arm regression in bridge.ts", () => {
  it("bridge.ts MUST NOT contain both `originals.custom` and `prompt.type === \"multiselect\"`", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const bridgePath = path.resolve(here, "..", "bridge.ts");
    const src = await fs.readFile(bridgePath, "utf-8");

    const hasA = src.includes(FORBIDDEN_A);
    const hasB = src.includes(FORBIDDEN_B);

    if (hasA && hasB) {
      const linesA = findLineNumbers(src, FORBIDDEN_A);
      const linesB = findLineNumbers(src, FORBIDDEN_B);
      const msg =
        `Forbidden co-occurrence in ${path.relative(process.cwd(), bridgePath)}:\n` +
        `  - "${FORBIDDEN_A}" found on line(s): ${linesA.join(", ")}\n` +
        `  - "${FORBIDDEN_B}" found on line(s): ${linesB.join(", ")}\n` +
        `\n` +
        `This pattern was removed by change "fix-multiselect-tui-arm-self-cancel".\n` +
        `pi 0.70 RPC mode's ctx.ui.custom is a no-op, so a TUI multiselect\n` +
        `arm that awaits originals.custom auto-cancels the dashboard-rendered\n` +
        `dialog within ~1 event-loop tick. The bus-routed ctx.ui.multiselect\n` +
        `patch + DashboardDefaultAdapter handle multiselect end-to-end without\n` +
        `any TUI arm participation. See:\n` +
        `  openspec/changes/archive/<date>-fix-multiselect-tui-arm-self-cancel/\n` +
        `(or openspec/changes/fix-multiselect-tui-arm-self-cancel/ if not yet archived).`;
      expect.fail(msg);
    }

    // Guardrail: at least one of the two substrings absent (we already
    // assert above that both-present is illegal). Either-alone is fine.
    expect(hasA && hasB).toBe(false);
  });
});
