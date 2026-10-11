/**
 * Repo-level invariant: `packages/extension/src/tui-prompt-adapter.ts` MUST NOT
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
 * `~/.nvm/.../@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js`
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
 * Scan target: the TUI arm can only be re-added in `tui-prompt-adapter.ts` (the
 * `originals` capture lives in `bridge-handlers/ui-prompt-patch.ts`, the arm match in
 * the adapter, so only the adapter file can hold both substrings). The previous target,
 * `bridge.ts`, never held the arm, so this guard passed vacuously. The negative check
 * below proves the predicate fires on a re-added arm.
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

/** True when both banned substrings co-occur, i.e. the TUI multiselect arm is back. */
function hasForbiddenArm(src: string): boolean {
  return src.includes(FORBIDDEN_A) && src.includes(FORBIDDEN_B);
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const adapterPath = path.resolve(here, "..", "tui-prompt-adapter.ts");

/**
 * @structural-pin regression lint: a banned substring co-occurrence must never reappear in the prompt adapter; absence of text is the contract
 */
describe("no TUI multiselect arm regression in tui-prompt-adapter.ts", () => {
  it("tui-prompt-adapter.ts MUST NOT contain both `originals.custom` and `prompt.type === \"multiselect\"`", async () => {
    const src = await fs.readFile(adapterPath, "utf-8");

    if (hasForbiddenArm(src)) {
      const linesA = findLineNumbers(src, FORBIDDEN_A);
      const linesB = findLineNumbers(src, FORBIDDEN_B);
      const msg =
        `Forbidden co-occurrence in ${path.relative(process.cwd(), adapterPath)}:\n` +
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
  });

  it("the predicate fires when the arm is re-added (negative check, not vacuous)", async () => {
    const src = await fs.readFile(adapterPath, "utf-8");
    expect(hasForbiddenArm(src)).toBe(false);
    const mutated = `${src}\nelse if (prompt.type === "multiselect" && originals.custom) {}\n`;
    expect(hasForbiddenArm(mutated)).toBe(true);
  });
});
