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
      id: "flows.run", source: "flows", label: "Run",
      buildEvent: () => ({ eventType: "flow:run", data: {} }),
    });
    expect(ok).toBe(true);
    expect(reg.get("flows.run")?.buildEvent).toBeDefined();
  });

  it("collectActionRegistry merges published contributions (single + array) with guards", () => {
    const entries = [
      { key: "automation.action.core", value: coreActionContributions() }, // array
      { key: "automation.action.flows", value: { id: "flows.run", source: "flows", label: "Run", buildEvent: () => ({ eventType: "flow:run" }) } }, // single
      { key: "automation.action.bad", value: { id: "nodispatch", source: "bad", label: "X" } }, // rejected: bad id + no dispatch
    ];
    const reg = collectActionRegistry(entries, { warn: () => {} });
    const ids = [...reg.ids()].sort();
    expect(ids).toEqual(["core.prompt", "core.skill", "flows.run"]);
    expect(reg.get("flows.run")?.buildEvent).toBeDefined();
  });

  it("collectActionRegistry tolerates non-object contribution values", () => {
    const reg = collectActionRegistry([{ key: "automation.action.junk", value: 42 }], { warn: () => {} });
    expect([...reg.ids()]).toEqual([]);
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
