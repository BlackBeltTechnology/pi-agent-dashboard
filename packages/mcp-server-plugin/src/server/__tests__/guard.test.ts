/**
 * Self-target refusal guard.
 *
 * Covers test-plan G1 (self-target refused), G2 (slash command refused before
 * dispatch), G3 (cross-session permitted), G4 (sessionless caller unaffected),
 * G6 (the documented indirect-loop limit) and G7 (equality is not bypassable
 * by trivial mutation).
 */
import { rank } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { describe, expect, it, vi } from "vitest";
import { type DispatchDeps, dispatchRpc, type InjectOptions } from "../dispatch.js";
import { type GeneratedTool, GENERATED_TOOLS } from "../generated/tools.js";
import { evaluateSelfTarget, SESSION_TARGETING_TOOLS } from "../guard.js";
import { META_VERSION_KEY } from "../protocol.js";
import type { McpCaller } from "../tokens.js";

const sessionCaller = (sessionId: string): McpCaller => ({ kind: "session", sessionId, tier: "control" });
const deviceCaller: McpCaller = { kind: "device", deviceId: "device-1", tier: "operate" };

describe("evaluateSelfTarget — G1 self-target is refused", () => {
  it("refuses when the caller's resolved session equals the target", () => {
    const r = evaluateSelfTarget(sessionCaller("A"), "A", "send_prompt");
    expect(r.allowed).toBe(false);
    expect(r).toMatchObject({
      allowed: false,
      reason: "self-target",
      callerSessionId: "A",
      targetSessionId: "A",
      tool: "send_prompt",
    });
  });

  it("G5 — the refusal carries caller, target and tool so it can be recorded", () => {
    const r = evaluateSelfTarget(sessionCaller("A"), "A", "abort");
    expect(r.allowed).toBe(false);
    if (r.allowed) throw new Error("unreachable");
    expect(r.callerSessionId).toBe("A");
    expect(r.targetSessionId).toBe("A");
    expect(r.tool).toBe("abort");
  });

  it("refuses for every session-targeting tool, not just send_prompt", () => {
    for (const tool of SESSION_TARGETING_TOOLS) {
      expect(evaluateSelfTarget(sessionCaller("A"), "A", tool).allowed).toBe(false);
    }
  });
});

describe("evaluateSelfTarget — G3 cross-session is permitted", () => {
  it("permits a session caller targeting a different session", () => {
    expect(evaluateSelfTarget(sessionCaller("A"), "B", "send_prompt").allowed).toBe(true);
  });

  it("G6 — permits the indirect two-session loop, encoding the documented limit", () => {
    // A targets B and B targets A. Both are permitted: the guard catches
    // DIRECT self-targeting only. This is asserted so that narrowing the scope
    // later is a deliberate spec edit rather than an accident.
    expect(evaluateSelfTarget(sessionCaller("A"), "B", "send_prompt").allowed).toBe(true);
    expect(evaluateSelfTarget(sessionCaller("B"), "A", "send_prompt").allowed).toBe(true);
  });
});

describe("evaluateSelfTarget — G4 a sessionless caller is unaffected", () => {
  it("permits a device-token caller targeting any session", () => {
    expect(evaluateSelfTarget(deviceCaller, "A", "send_prompt").allowed).toBe(true);
    expect(evaluateSelfTarget(deviceCaller, "B", "send_prompt").allowed).toBe(true);
  });

  it("permits a device-token caller even when the target id looks like its device id", () => {
    expect(evaluateSelfTarget(deviceCaller, "device-1", "send_prompt").allowed).toBe(true);
  });
});

describe("evaluateSelfTarget — G7 equality is not bypassable", () => {
  const caller = sessionCaller("0199aa-BB-cc");

  it.each([
    ["exact", "0199aa-BB-cc"],
    ["upper case", "0199AA-BB-CC"],
    ["lower case", "0199aa-bb-cc"],
    ["leading whitespace", "  0199aa-BB-cc"],
    ["trailing whitespace", "0199aa-BB-cc\t"],
    ["surrounding whitespace", "  0199aa-BB-cc  "],
    ["double quotes", '"0199aa-BB-cc"'],
    ["single quotes", "'0199aa-BB-cc'"],
    ["quotes and whitespace", '  "0199aa-BB-cc" '],
    ["a newline", "0199aa-BB-cc\n"],
  ])("still refuses when the target differs only by %s", (_label, target) => {
    expect(evaluateSelfTarget(caller, target, "send_prompt").allowed).toBe(false);
  });

  it("does not over-normalise — a genuinely different session is still permitted", () => {
    // The normalisation must not collapse distinct ids into one, or the guard
    // would refuse legitimate cross-session control.
    expect(evaluateSelfTarget(caller, "0199aa-BB-cd", "send_prompt").allowed).toBe(true);
    expect(evaluateSelfTarget(caller, "0199aa-BB-c", "send_prompt").allowed).toBe(true);
    expect(evaluateSelfTarget(caller, "x0199aa-BB-cc", "send_prompt").allowed).toBe(true);
  });

  it("does not strip mismatched quotes as if they were a pair", () => {
    expect(evaluateSelfTarget(caller, '"0199aa-BB-cc', "send_prompt").allowed).toBe(true);
  });
});

describe("evaluateSelfTarget — G2 the slash-command path", () => {
  it("refuses a self-targeted prompt whose text is a slash command", () => {
    // G2's aggravation is that `/`-prefixed text reaches extension-command
    // dispatch. The guard must therefore decide BEFORE the text is inspected —
    // the refusal cannot depend on the payload at all.
    const r = evaluateSelfTarget(sessionCaller("A"), "A", "send_prompt");
    expect(r.allowed).toBe(false);
  });

  it("reaches the same verdict regardless of the prompt text", () => {
    // Same inputs, same answer: the guard has no text parameter to be fooled
    // by, so no crafted payload can route around it.
    const plain = evaluateSelfTarget(sessionCaller("A"), "A", "send_prompt");
    const slash = evaluateSelfTarget(sessionCaller("A"), "A", "send_prompt");
    expect(plain).toEqual(slash);
  });
});

describe("evaluateSelfTarget — malformed input", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", {}],
  ])("permits (defers to argument validation) when the target is %s", (_label, target) => {
    // A malformed target is an invalid-params problem, not a guard verdict.
    // The guard must not swallow it by refusing, or E26's invalid-params
    // assertion would be masked by a self-target refusal.
    const r = evaluateSelfTarget(sessionCaller("A"), target as unknown as string, "send_prompt");
    expect(r.allowed).toBe(true);
  });
});

// See change: close-security-map-high-findings (test-plan #E49): with
// `prompt_response` gone, the guard still covers every remaining row that targets
// a session — enumerated from the generated surface, not hand-listed.
describe("E49 — self-target guard enumerates the remaining session-targeting rows", () => {
  const V = "2026-07-28";
  const rows = GENERATED_TOOLS.filter((t) => t.sessionTargeting);

  /** Minimal schema-valid args for a row, with `sessionId` = target. */
  function argsFor(tool: GeneratedTool, target: string): Record<string, unknown> {
    const props = (tool.inputSchema.properties ?? {}) as Record<string, { type?: string; enum?: unknown[] }>;
    const out: Record<string, unknown> = {};
    for (const key of tool.inputSchema.required ?? []) {
      const p = props[key] ?? {};
      if (key === "sessionId") out[key] = target;
      else if (p.enum?.length) out[key] = p.enum[0];
      else if (p.type === "number" || p.type === "integer") out[key] = 1;
      else if (p.type === "boolean") out[key] = true;
      else if (p.type === "array") out[key] = [];
      else if (p.type === "object") out[key] = {};
      else out[key] = "x";
    }
    return out;
  }

  const mkDeps = (over: Partial<DispatchDeps> = {}): DispatchDeps => ({
    invokeTool: vi.fn(async () => ({ ok: true })),
    inject: vi.fn(async (_o: InjectOptions) => ({ statusCode: 200, body: { success: true, data: {} } })),
    sendToSession: vi.fn(() => true),
    serverInfo: { name: "pi-dashboard", version: "0.0.0" },
    recordRefusal: vi.fn(),
    recordTierRefusal: vi.fn(),
    ...over,
  });
  const call = (tool: GeneratedTool, target: string, caller: McpCaller, d: DispatchDeps) =>
    dispatchRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { _meta: { [META_VERSION_KEY]: V }, name: tool.name, arguments: argsFor(tool, target) },
      },
      { era: "modern", version: V },
      caller,
      d,
    );

  it("the residual `session` rows are present and the guard list has no prompt-response", () => {
    const names = rows.map((r) => r.name);
    for (const n of ["set_session_tags", "edit_followup_entry", "history_backfill"]) {
      expect(names, n).toContain(n);
    }
    expect(names).not.toContain("prompt_response");
    expect(names).not.toContain("extension_ui_response");
    expect(SESSION_TARGETING_TOOLS as readonly string[]).not.toContain("prompt_response");
    expect(SESSION_TARGETING_TOOLS as readonly string[]).not.toContain("prompt-response");
  });

  it.each(rows.map((r) => [r.name, r] as const))("%s: A→A is refused (tier first, then guard)", async (_n, tool) => {
    const d = mkDeps();
    const r = await call(tool, "A", sessionCaller("A"), d);
    expect(r.status).toBe(403);
    expect(d.invokeTool).not.toHaveBeenCalled();
    expect(d.inject).not.toHaveBeenCalled();
    expect(d.sendToSession).not.toHaveBeenCalled();
    if (rank(tool.tier) > rank("control")) {
      expect(d.recordTierRefusal).toHaveBeenCalledOnce();
      expect(d.recordRefusal).not.toHaveBeenCalled();
    } else {
      expect(d.recordRefusal).toHaveBeenCalledWith({ callerSessionId: "A", targetSessionId: "A", tool: tool.name });
    }
  });

  it.each(rows.map((r) => [r.name, r] as const))("%s: A→B is not a self-target refusal", async (_n, tool) => {
    const d = mkDeps();
    const r = await call(tool, "B", sessionCaller("A"), d);
    expect(d.recordRefusal).not.toHaveBeenCalled();
    if (rank(tool.tier) > rank("control")) expect(r.status).toBe(403);
    else expect(r.status).toBe(200);
  });

  it("a sessionless (device) caller is unaffected for A→A", async () => {
    const tool = rows.find((r) => rank(r.tier) <= rank("control")) as GeneratedTool;
    const d = mkDeps();
    const r = await call(tool, "A", { kind: "device", deviceId: "d1", tier: "operate" }, d);
    expect(r.status).toBe(200);
    expect(d.recordRefusal).not.toHaveBeenCalled();
  });
});
