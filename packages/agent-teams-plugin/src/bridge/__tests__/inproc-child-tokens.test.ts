/**
 * Token cost of an in-process child's first model request (test-plan S99; spike: ≈50k tokens per teammate): lean children carry no
 * discovered extension, and the team tool set — the part this plugin owns — stays inside a committed size baseline. The estimator is
 * characters / 4 over the system prompt, the active tool declarations and the transcript (a ratchet, not a tokenizer).
 * See change: add-agent-teams-in-process.
 */
import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, startFauxChild } from "../../__tests__/harness/faux-child.js";
import { createChildWorld } from "../../__tests__/harness/inproc-child-env.js";
import { createTeamTools } from "../tools.js";

/** Committed baseline of the teammate tool declarations (names, descriptions, schemas) in estimated tokens; +10 % is the ratchet. */
const TEAM_TOOLS_BASELINE_TOKENS = 1075;

const estimate = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4);
const requestTokens = (r: { system: string; toolSchemas: unknown; messages: unknown }): number => estimate([r.system, r.toolSchemas, r.messages]);

describe("S99 token cost of the child tool set and base context", () => {
  it("the teammate tool declarations stay within the committed baseline +10%", () => {
    const member = createTeamTools({ call: async () => ({ ok: true, data: {} }) }).filter((t) => ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "SendMessage", "TeamStatus", "ShutdownResponse", "PlanSubmit"].includes(t.name));
    const tokens = estimate(member.map(({ name, description, parameters }) => ({ name, description, parameters })));
    expect(tokens).toBeLessThanOrEqual(Math.ceil(TEAM_TOOLS_BASELINE_TOKENS * 1.1));
  });

  it("a lean child's first request carries no discovered extension and is smaller than the full one; the non-lean value is the recorded baseline", async () => {
    const heavy = (n: number): string =>
      `export default function (pi) { pi.registerTool({ name: "foreign_${n}", label: "f", description: ${JSON.stringify("d".repeat(1500))}, parameters: { type: "object", properties: { q: { type: "string", description: ${JSON.stringify("q".repeat(500))} } } }, execute: async () => ({ content: [{ type: "text", text: "x" }], details: {} }) }); }`;
    const discovered = { f1: heavy(1), f2: heavy(2), f3: heavy(3) };
    const sizes: Record<string, number> = {};
    for (const lean of [false, true]) {
      const w = await createChildWorld({ config: { inProcessLeanChildren: lean } });
      const { command } = await w.spawn("bob");
      const child = await startFauxChild({ extensionFactories: [w.extensionOf("bob")], script: [fauxAssistantMessage("ok")], noContextFiles: true, ...(lean ? { noExtensions: true } : {}), discovered });
      await child.run("go");
      const request = child.requests[0];
      expect(request).toBeDefined();
      sizes[lean ? "lean" : "full"] = requestTokens(request as NonNullable<typeof request>);
      expect(request?.activeTools.some((n) => n.startsWith("foreign_"))).toBe(!lean);
      expect(command?.spec.leanChildren).toBe(lean);
    }
    expect(sizes.lean).toBeLessThan(sizes.full as number);
  });

  // The target "lean first request ≤ 25 % of the full one" depends on the lead's REAL discovered extensions (spike: ≈50k tokens of tool
  // schemas); a synthetic fixture would only measure itself. Pending a run with a real extension set.
  it.todo("lean first request ≤ 25 % of the non-lean first request with the lead's real discovered extensions (needs a real environment)");
});
