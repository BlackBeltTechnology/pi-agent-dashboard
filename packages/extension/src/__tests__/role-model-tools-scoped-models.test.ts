/**
 * ctx.scopedModels scope-awareness for list_models (pi ≥ 0.83.0).
 *
 * The load-bearing case is E2: ctx.scopedModels is EMPTY when no scoping is
 * configured ("every available model is usable"), so a presence check would
 * empty the catalogue on every default 0.83.0 session. The gate is non-empty
 * length; absent OR empty → byte-identical fallback.
 *
 * See change: update-pi-core-0-83-adopt-apis (test-plan #E1-#E4, #X1).
 */
import { describe, expect, it } from "vitest";
import { filterRowsByScope, registerRoleModelTools, type ModelRow } from "../role-model-tools.js";

function mkPi() {
  const tools = new Map<string, any>();
  const pi: any = { registerTool: (t: any) => tools.set(t.name, t), events: { on: () => {} } };
  return { pi, tools };
}
function makeRegistry(available: any[]) {
  return { getAvailable: () => available, getAll: () => available };
}
const AVAIL = [
  { provider: "x", id: "A" },
  { provider: "y", id: "B" },
  { provider: "z", id: "C" },
];
async function listModels(deps: any) {
  const { pi, tools } = mkPi();
  registerRoleModelTools(pi, deps);
  const res = await tools.get("list_models").execute("id", {}, null, null, {});
  return res.details;
}

describe("list_models scope-awareness (ctx.scopedModels)", () => {
  it("E1: non-empty scope narrows the catalogue; refs preserved, registryReady unchanged", async () => {
    const details = await listModels({
      getRegistry: () => makeRegistry(AVAIL),
      getScopedModels: () => [{ model: { provider: "x", id: "A" } }],
    });
    expect(details.models.map((m: ModelRow) => m.ref)).toEqual(["x/A"]);
    expect(details.registryReady).toBe(true);
  });

  it("E2: present-but-empty scope falls back to the full catalogue (no models dropped)", async () => {
    const scoped = await listModels({ getRegistry: () => makeRegistry(AVAIL), getScopedModels: () => [] });
    const absent = await listModels({ getRegistry: () => makeRegistry(AVAIL) });
    expect(scoped.models.map((m: ModelRow) => m.ref)).toEqual(["x/A", "y/B", "z/C"]);
    // byte-identical to the absent case
    expect(JSON.stringify(scoped)).toBe(JSON.stringify(absent));
  });

  it("E3: absent scope falls back unchanged and does not throw", async () => {
    const details = await listModels({ getRegistry: () => makeRegistry(AVAIL), getScopedModels: () => undefined });
    expect(details.models).toHaveLength(3);
    expect(details.registryReady).toBe(true);
  });

  it("E4: ref derived from the Model object matches the row key (object-vs-string boundary)", () => {
    const rows: ModelRow[] = [
      { ref: "anthropic/claude-x", provider: "anthropic", id: "claude-x" },
      { ref: "openai/gpt", provider: "openai", id: "gpt" },
    ];
    // scoped entries carry a Model OBJECT under `.model`, not a ref string
    const out = filterRowsByScope(rows, [{ model: { provider: "anthropic", id: "claude-x" } }]);
    expect(out.map((r) => r.ref)).toEqual(["anthropic/claude-x"]);
  });

  it("E4b: a scope of Model objects never yields an all-empty result via object!=string mismatch", () => {
    const rows: ModelRow[] = [{ ref: "x/A", provider: "x", id: "A" }];
    // naive Set(scoped.map(s => s.model)) would be object refs → empty; ours derives provider/id
    expect(filterRowsByScope(rows, [{ model: { provider: "x", id: "A" } }])).toHaveLength(1);
  });

  it("X1: getScopedModels absent (older pi) → no throw, full fallback", async () => {
    const details = await listModels({ getRegistry: () => makeRegistry(AVAIL) }); // no getScopedModels dep
    expect(details.models).toHaveLength(3);
  });

  it("malformed scope (no parseable ref) falls back rather than emptying", () => {
    const rows: ModelRow[] = [{ ref: "x/A", provider: "x", id: "A" }];
    expect(filterRowsByScope(rows, [{ model: {} }, { thinkingLevel: "high" }])).toHaveLength(1);
  });
});
