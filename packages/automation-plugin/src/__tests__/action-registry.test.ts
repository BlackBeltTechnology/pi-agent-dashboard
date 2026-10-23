/**
 * ActionRegistry — registration, namespacing, per-source cap, built-ins,
 * and cwd-resolved descriptors. See change: register-plugin-automation-events.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ActionRegistry,
  createActionRegistryWithBuiltins,
  coreActionContributions,
  collectActionRegistry,
  normalizeActionKind,
  MAX_PER_SOURCE,
} from "../server/action-registry.js";

const noopBuild = () => "";

describe("ActionRegistry", () => {
  it("registers a namespaced action and exposes it by id", () => {
    const reg = new ActionRegistry();
    expect(reg.register({ id: "flows.run", source: "flows", label: "Run", buildPrompt: noopBuild })).toBe(true);
    expect(reg.has("flows.run")).toBe(true);
    expect(reg.ids().has("flows.run")).toBe(true);
  });

  it("rejects malformed ids and duplicates with a warning, no throw", () => {
    const warn = vi.fn();
    const reg = new ActionRegistry({ warn });
    expect(reg.register({ id: "bareid", source: "x", label: "x", buildPrompt: noopBuild })).toBe(false);
    reg.register({ id: "x.a", source: "x", label: "a", buildPrompt: noopBuild });
    expect(reg.register({ id: "x.a", source: "x", label: "dup", buildPrompt: noopBuild })).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("enforces the per-source cap, keeping the first MAX_PER_SOURCE", () => {
    const reg = new ActionRegistry();
    for (let i = 0; i < MAX_PER_SOURCE; i++) {
      expect(reg.register({ id: `s.v${i}`, source: "s", label: `${i}`, buildPrompt: noopBuild })).toBe(true);
    }
    expect(reg.register({ id: "s.overflow", source: "s", label: "x", buildPrompt: noopBuild })).toBe(false);
    expect(reg.ids().size).toBe(MAX_PER_SOURCE);
  });

  it("built-ins core.prompt + core.skill are present", () => {
    const reg = createActionRegistryWithBuiltins();
    expect(reg.has("core.prompt")).toBe(true);
    expect(reg.has("core.skill")).toBe(true);
  });

  it("normalizeActionKind maps bare prompt/skill to core.*", () => {
    expect(normalizeActionKind("prompt")).toBe("core.prompt");
    expect(normalizeActionKind("skill")).toBe("core.skill");
    expect(normalizeActionKind("flows.run")).toBe("flows.run");
  });

  it("descriptorsForCwd resolves availability + enum options", () => {
    const reg = new ActionRegistry();
    reg.register({
      id: "flows.run",
      source: "flows",
      label: "Run",
      available: (cwd) => cwd === "/has-flows",
      unavailableReason: "no flows in this folder",
      payloadSchema: [
        { key: "flow", label: "Flow", type: "enum", options: (cwd) => (cwd === "/has-flows" ? ["a", "b"] : []) },
        { key: "task", label: "Task", type: "multiline" },
      ],
      buildPrompt: noopBuild,
    });

    const here = reg.descriptorsForCwd("/has-flows").find((d) => d.id === "flows.run")!;
    expect(here.available).toBe(true);
    expect(here.payloadSchema[0].options).toEqual(["a", "b"]);

    const elsewhere = reg.descriptorsForCwd("/no-flows").find((d) => d.id === "flows.run")!;
    expect(elsewhere.available).toBe(false);
    expect(elsewhere.unavailableReason).toBe("no flows in this folder");
  });

  it("descriptors are sorted by source then id", () => {
    const reg = createActionRegistryWithBuiltins();
    reg.register({ id: "flows.run", source: "flows", label: "Run", buildPrompt: noopBuild });
    const ds = reg.descriptorsForCwd("/x");
    const sources = ds.map((d) => d.source);
    expect(sources).toEqual([...sources].sort());
  });

  it("accepts an event-dispatch action (buildEvent)", () => {
    const reg = new ActionRegistry();
    const ok = reg.register({
      id: "flows.run", source: "flows", label: "Run", emits: ["flow:run"],
      buildEvent: () => ({ eventType: "flow:run", data: {} }),
    });
    expect(ok).toBe(true);
    expect(reg.get("flows.run")?.buildEvent).toBeDefined();
  });

  it("collectActionRegistry merges published contributions (single + array) with guards", () => {
    const entries = [
      { key: "automation.action.core", provider: "host", value: coreActionContributions() }, // array
      { key: "automation.action.flows", provider: "flows", value: { id: "flows.run", source: "flows", label: "Run", emits: ["flow:run"], buildEvent: () => ({ eventType: "flow:run" }) } }, // single
      { key: "automation.action.bad", provider: "bad", value: { id: "nodispatch", source: "bad", label: "X" } }, // rejected: bad id + no dispatch
    ];
    const reg = collectActionRegistry(entries, { warn: () => {}, providerEmits: (id) => (id === "flows" ? ["flow:run"] : undefined) });
    const ids = [...reg.ids()].sort();
    expect(ids).toEqual(["core.prompt", "core.skill", "flows.run"]);
    expect(reg.get("flows.run")?.buildEvent).toBeDefined();
  });

  it("collectActionRegistry tolerates non-object contribution values", () => {
    const reg = collectActionRegistry([{ key: "automation.action.junk", provider: "junk", value: 42 }], { warn: () => {} });
    expect([...reg.ids()]).toEqual([]);
  });

  it("buildEvent requires a non-empty emits list; buildPrompt does not (E23)", () => {
    const reg = new ActionRegistry({ warn: () => {} });
    const be = () => ({ eventType: "flow:run" });
    expect(reg.register({ id: "a.noemits", source: "a", label: "A", buildEvent: be })).toBe(false);
    expect(reg.register({ id: "a.empty", source: "a", label: "A", emits: [], buildEvent: be })).toBe(false);
    expect(reg.register({ id: "a.ok", source: "a", label: "A", emits: ["flow:run"], buildEvent: be })).toBe(true);
    expect(reg.register({ id: "a.prompt", source: "a", label: "A", buildPrompt: noopBuild })).toBe(true);
    expect([...reg.ids()].sort()).toEqual(["a.ok", "a.prompt"]);
  });

  it("rejects an action with neither or both of buildPrompt/buildEvent", () => {
    const warn = vi.fn();
    const reg = new ActionRegistry({ warn });
    expect(reg.register({ id: "x.none", source: "x", label: "N" } as any)).toBe(false);
    expect(reg.register({
      id: "x.both", source: "x", label: "B",
      buildPrompt: noopBuild, buildEvent: () => null,
    } as any)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// test-plan #SE18, #SE19 — provider manifest `emits` gates event actions at
// registration; the consumeAll provider must equal the key's source.
// See change: harden-git-terminal-plugin-boundaries (D16).
describe("emits subset check at registration (SE18)", () => {
  const be = () => ({ eventType: "flow:run" });
  const manifests: Record<string, string[]> = { flows: ["flow:run"], evil: [], empty: [] };
  const providerEmits = (id: string) => manifests[id];
  const mk = (provider: string, over: Record<string, unknown>) => {
    const warn = vi.fn();
    const reg = new ActionRegistry({ warn, providerEmits });
    const ok = reg.register(
      { id: "flows.run", source: "flows", label: "Run", buildEvent: be, emits: ["flow:run"], ...over } as any,
      provider,
    );
    return { ok, reg, warn };
  };

  it("accepts an event action whose emits is within the provider manifest", () => {
    const { ok, reg } = mk("flows", {});
    expect(ok).toBe(true);
    expect(reg.has("flows.run")).toBe(true);
  });

  it("rejects the whole action when emits exceeds the manifest, naming provider and type", () => {
    const { ok, reg, warn } = mk("flows", { emits: ["flow:run", "custom:thing"] });
    expect(ok).toBe(false);
    expect(reg.has("flows.run")).toBe(false);
    const line = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(line).toContain("flows");
    expect(line).toContain("custom:thing");
  });

  it("uses the PROVIDER's manifest, not the key source: evil cannot borrow flows' emits", () => {
    const { ok, reg } = mk("evil", {});
    expect(ok).toBe(false);
    expect(reg.has("flows.run")).toBe(false);
  });

  it("accepts a prompt action from a provider with an empty manifest", () => {
    const { ok } = mk("empty", { buildEvent: undefined, emits: undefined, buildPrompt: noopBuild });
    expect(ok).toBe(true);
  });

  it("rejects an event action with missing emits", () => {
    const { ok } = mk("flows", { emits: undefined });
    expect(ok).toBe(false);
  });

  it("a rejected action does not abort collection of the others; rejected ones are not listed", () => {
    const warn = vi.fn();
    const reg = collectActionRegistry(
      [
        { key: "automation.action.core", provider: "host", value: coreActionContributions() },
        { key: "automation.action.flows", provider: "flows", value: [
          { id: "flows.run", source: "flows", label: "Run", emits: ["flow:run"], buildEvent: be },
          { id: "flows.bad", source: "flows", label: "Bad", emits: ["flow:run", "custom:thing"], buildEvent: be },
        ] },
      ],
      { warn, providerEmits },
    );
    expect([...reg.ids()].sort()).toEqual(["core.prompt", "core.skill", "flows.run"]);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("custom:thing");
  });

  it("collection with no providerEmits lookup fails closed for event actions", () => {
    const reg = collectActionRegistry(
      [{ key: "automation.action.flows", provider: "flows", value: { id: "flows.run", source: "flows", label: "Run", emits: ["flow:run"], buildEvent: be } }],
      { warn: () => {} },
    );
    expect(reg.has("flows.run")).toBe(false);
  });
});

describe("collection ignores entries whose provider is not the key source (SE19)", () => {
  const prompt = (id: string) => ({ id, source: id.split(".")[0], label: id, buildPrompt: noopBuild });

  it("ignores the evil entry with one warning; keeps host and matching-provider entries", () => {
    const warn = vi.fn();
    const reg = collectActionRegistry(
      [
        { key: "automation.action.flows", provider: "evil", value: prompt("flows.evilrun") },
        { key: "automation.action.core", provider: "host", value: prompt("core.prompt") },
        { key: "automation.action.flows", provider: "flows", value: prompt("flows.run") },
      ],
      { warn, providerEmits: () => [] },
    );
    expect([...reg.ids()].sort()).toEqual(["core.prompt", "flows.run"]);
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("evil");
    expect(lines[0]).toContain("automation.action.flows");
  });

  it("refuses an empty source segment as malformed with a warning", () => {
    const warn = vi.fn();
    const reg = collectActionRegistry(
      [
        { key: "automation.action.", provider: "host", value: prompt("x.a") },
        { key: "automation.action..x", provider: "host", value: prompt("x.b") },
      ],
      { warn, providerEmits: () => [] },
    );
    expect(reg.ids().size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("an entry without a provider is ignored (fail closed)", () => {
    const warn = vi.fn();
    const reg = collectActionRegistry(
      [{ key: "automation.action.flows", value: prompt("flows.run") } as any],
      { warn, providerEmits: () => [] },
    );
    expect(reg.ids().size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
