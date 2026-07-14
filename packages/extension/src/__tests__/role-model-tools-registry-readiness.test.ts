/**
 * Registry-readiness discriminator tests for the `list_models` tool.
 *
 * Exercises the four registry states the tool must distinguish so an empty
 * `models` array is never ambiguous between "registry not yet hydrated" and
 * "registry hydrated but exposes no reachable models":
 *   A. absent registry            → { models: [], registryReady: false, reason }
 *   B. hydrated-but-empty         → { models: [], registryReady: true }
 *   C. populated                  → { models: [...], registryReady: true }
 *   D. annotated + absent registry → { models: [], registryReady: false, reason }
 *
 * See change: fix-list-models-empty-on-unhydrated-registry.
 */

import { describe, expect, it } from "vitest";
import { registerRoleModelTools } from "../role-model-tools.js";

// Minimal pi stub capturing registered tools.
function mkPi() {
  const tools = new Map<string, any>();
  const pi: any = {
    registerTool: (t: any) => tools.set(t.name, t),
    events: { on: () => {}, emit: async () => {} },
  };
  return { pi, tools };
}

function makeRegistry(available: any[], all?: any[]) {
  return {
    getAvailable: () => available,
    getAll: () => all ?? available,
  };
}

// Parse the JSON text block emitted through `content` so we assert BOTH channels.
function parseContent(res: any) {
  return JSON.parse(res.content[0].text);
}

describe("list_models registry-readiness discriminator", () => {
  it("A. absent registry → registryReady:false + non-empty reason, no throw", async () => {
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => undefined });
    const res = await tools.get("list_models").execute("id", {}, null, null, {});

    expect(res.details.models).toEqual([]);
    expect(res.details.registryReady).toBe(false);
    expect(typeof res.details.reason).toBe("string");
    expect(res.details.reason.length).toBeGreaterThan(0);

    // Same envelope must appear in the text content block.
    const parsed = parseContent(res);
    expect(parsed.models).toEqual([]);
    expect(parsed.registryReady).toBe(false);
    expect(typeof parsed.reason).toBe("string");
    expect(parsed.reason.length).toBeGreaterThan(0);
  });

  it("B. hydrated-but-empty → registryReady:true, reason omitted/null", async () => {
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => makeRegistry([]) });
    const res = await tools.get("list_models").execute("id", {}, null, null, {});

    expect(res.details.models).toEqual([]);
    expect(res.details.registryReady).toBe(true);
    expect(res.details.reason ?? null).toBeNull();

    // Content channel carries the same envelope as details.
    const parsed = parseContent(res);
    expect(parsed.models).toEqual([]);
    expect(parsed.registryReady).toBe(true);
    expect(parsed.reason ?? null).toBeNull();
  });

  it("C. populated → registryReady:true + full rows with existing shape", async () => {
    const { pi, tools } = mkPi();
    const registry = makeRegistry([
      { provider: "anthropic", id: "claude-x", reasoning: true, input: ["text"], contextWindow: 200000, cost: { input: 3 } },
    ]);
    registerRoleModelTools(pi, { getRegistry: () => registry });
    const res = await tools.get("list_models").execute("id", {}, null, null, {});

    expect(res.details.registryReady).toBe(true);
    expect(res.details.models).toHaveLength(1);
    expect(res.details.models[0].ref).toBe("anthropic/claude-x");
    expect(res.details.models[0].reasoning).toBe(true);
    expect(res.details.reason ?? null).toBeNull();

    // Content channel carries the same envelope as details.
    const parsed = parseContent(res);
    expect(parsed.registryReady).toBe(true);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0].ref).toBe("anthropic/claude-x");
    expect(parsed.reason ?? null).toBeNull();
  });

  it("D. annotated + absent registry → registryReady:false + reason (not silent empty)", async () => {
    const { pi, tools } = mkPi();
    registerRoleModelTools(pi, { getRegistry: () => undefined });
    const res = await tools.get("list_models").execute("id", { annotated: true }, null, null, {});

    expect(res.details.models).toEqual([]);
    expect(res.details.registryReady).toBe(false);
    expect(typeof res.details.reason).toBe("string");
    expect(res.details.reason.length).toBeGreaterThan(0);

    // Content channel carries the same envelope as details.
    const parsed = parseContent(res);
    expect(parsed.models).toEqual([]);
    expect(parsed.registryReady).toBe(false);
    expect(typeof parsed.reason).toBe("string");
    expect(parsed.reason.length).toBeGreaterThan(0);
  });
});
