/**
 * emitEventToSession / sendExtensionMessage: reserved namespaces, the raw
 * plugin_emit_event lane, and the manifest `emits` allowlist (declared types
 * only; automation's allowlist = own emits ∪ providers of accepted
 * `automation.action.*` registrations, computed live).
 * See change: harden-trust-and-credential-boundaries (D3; T-E21, E22);
 * harden-git-terminal-plugin-boundaries (D16; test-plan #SE24, #SE25, #SE40, #SP1, #SP5, #SX7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeEmitAllowlist,
  type EmitAllowlistDeps,
  emitEventToSession,
  resetEmitWarnings,
  sendExtensionMessage,
} from "../plugin-event-seam.js";

beforeEach(() => resetEmitWarnings());
afterEach(() => vi.restoreAllMocks());

/** Fake host state: loaded plugin manifests + published action entries. */
function fakeHost(
  manifests: Record<string, string[] | undefined>,
  entries: Array<{ key: string; value: unknown; provider: string }> = [],
) {
  const state = { manifests, entries };
  const deps: EmitAllowlistDeps = {
    manifestEmits: (id) => state.manifests[id],
    actionEntries: () => state.entries,
  };
  /** One plugin's `ctx.emitEventToSession`, as server.ts wires it. */
  const emitter = (pluginId: string, send: (sid: string, m: any) => boolean, trusted = true) =>
    (eventType: unknown, data?: Record<string, unknown>) =>
      emitEventToSession(trusted, send, "s1", eventType as string, data, {
        pluginId,
        allowed: () => computeEmitAllowlist(pluginId, deps),
      });
  return { state, deps, emitter };
}

const eventAction = (emits: string[]) => ({ id: "flows.run", buildEvent: () => null, emits });

describe("emitEventToSession — reserved prefixes and basics", () => {
  it.each(["roles:set", "role:resolve-model", "model:resolve", "prompt:register-adapter", "dashboard:enqueue-followup", "ui:invalidate"])(
    "refuses reserved %s with one warn",
    (t) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi.fn(() => true);
      const { emitter } = fakeHost({ p: [t] });
      const emit = emitter("p", send);
      expect(emit(t, {})).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["roles", "rolesx:set", "flow:run"])("allows declared non-reserved %s", (t) => {
    const send = vi.fn(() => true);
    const { emitter } = fakeHost({ p: [t] });
    expect(emitter("p", send)(t, {})).toBe(true);
    expect(send).toHaveBeenCalledWith("s1", { type: "plugin_emit_event", sessionId: "s1", eventType: t, data: {} });
  });

  it("untrusted plugin is refused even for a declared type", () => {
    const send = vi.fn(() => true);
    const { emitter } = fakeHost({ p: ["flow:run"] });
    expect(emitter("p", send, false)("flow:run", {})).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendExtensionMessage", () => {
  it("refuses the raw plugin_emit_event lane", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    expect(sendExtensionMessage(true, send, "s1", { type: "plugin_emit_event", eventType: "roles:set" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("passes other message types", () => {
    const send = vi.fn(() => true);
    expect(sendExtensionMessage(true, send, "s1", { type: "mcp_token_minted" })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("SE24 — trusted × manifest emits × event type", () => {
  const types: unknown[] = ["flow:run", "custom:thing", "roles:set", "dashboard:enqueue-followup", "flow:run2", "", 123, undefined];
  const manifests: Array<[string, string[] | undefined]> = [["declares flow:run", ["flow:run"]], ["absent", undefined], ["empty", []]];

  for (const trusted of [true, false]) {
    for (const [label, emits] of manifests) {
      it.each(types.map((t) => [String(t) === "" ? '""' : String(t), t]))(
        `trusted=${trusted} manifest ${label} · %s`,
        (_n, t) => {
          vi.spyOn(console, "warn").mockImplementation(() => {});
          const send = vi.fn(() => true);
          const { emitter } = fakeHost({ p: emits });
          const ok = emitter("p", send, trusted)(t);
          const expected = trusted && emits?.includes("flow:run") === true && t === "flow:run";
          expect(ok).toBe(expected);
          expect(send).toHaveBeenCalledTimes(expected ? 1 : 0);
        },
      );
    }
  }

  it("the raw plugin_emit_event lane stays closed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    expect(sendExtensionMessage(true, send, "s1", { type: "plugin_emit_event", eventType: "roles:set" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("SE25 — automation allowlist from accepted registrations", () => {
  const manifests = { automation: [], flows: ["flow:run", "dashboard-flows:report-files"], evil: [] };

  it("flow:run and report-files dispatch after a flows registration is accepted; custom:thing never", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { emitter } = fakeHost(manifests, [
      { key: "automation.action.flows", provider: "flows", value: eventAction(["flow:run"]) },
    ]);
    const emit = emitter("automation", send);
    expect(emit("flow:run")).toBe(true);
    expect(emit("dashboard-flows:report-files")).toBe(true); // provider's WHOLE manifest emits
    expect(emit("custom:thing")).toBe(false);
  });

  it("refuses flow:run when only evil's (rejected) registration exists", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { emitter } = fakeHost(manifests, [
      { key: "automation.action.flows", provider: "evil", value: eventAction(["flow:run"]) },
    ]);
    const emit = emitter("automation", send);
    expect(emit("flow:run")).toBe(false);
    expect(emit("dashboard-flows:report-files")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("a rejected flows registration (emits beyond its manifest) widens nothing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { emitter } = fakeHost(manifests, [
      { key: "automation.action.flows", provider: "flows", value: eventAction(["flow:run", "custom:thing"]) },
    ]);
    const emit = emitter("automation", send);
    expect(emit("flow:run")).toBe(false);
    expect(emit("custom:thing")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("host-attributed and prompt-only entries add nothing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { deps } = fakeHost(manifests, [
      { key: "automation.action.core", provider: "host", value: [{ id: "core.prompt", buildPrompt: () => "" }] },
      { key: "automation.action.flows", provider: "flows", value: { id: "flows.p", buildPrompt: () => "" } },
    ]);
    expect([...computeEmitAllowlist("automation", deps)]).toEqual([]);
  });

  it("only the automation plugin gets provider types; other plugins keep their own manifest", () => {
    const { deps } = fakeHost(manifests, [
      { key: "automation.action.flows", provider: "flows", value: eventAction(["flow:run"]) },
    ]);
    expect([...computeEmitAllowlist("evil", deps)]).toEqual([]);
    expect([...computeEmitAllowlist("flows", deps)].sort()).toEqual(["dashboard-flows:report-files", "flow:run"]);
  });
});

describe("SE40 — allowlist is live", () => {
  it("follows the provider's lifetime: loaded → unloaded → reloaded", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { state, emitter } = fakeHost(
      { automation: [], flows: ["flow:run", "dashboard-flows:report-files"] },
      [{ key: "automation.action.flows", provider: "flows", value: eventAction(["flow:run"]) }],
    );
    const emit = emitter("automation", send);
    expect(emit("flow:run")).toBe(true);
    expect(emit("dashboard-flows:report-files")).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);

    state.manifests.flows = undefined; // unloaded / disabled
    send.mockClear();
    expect(emit("flow:run")).toBe(false);
    expect(emit("dashboard-flows:report-files")).toBe(false);
    expect(send).not.toHaveBeenCalled();

    state.manifests.flows = ["flow:run", "dashboard-flows:report-files"]; // reloaded
    expect(emit("flow:run")).toBe(true);
    expect(emit("dashboard-flows:report-files")).toBe(true);
  });
});

describe("undeclared-emit warnings", () => {
  it("SP1 — 10 000 refused calls log exactly one warning naming plugin, type and `emits`", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { emitter } = fakeHost({ p: undefined });
    const emit = emitter("p", send);
    for (let i = 0; i < 10_000; i++) expect(emit("custom:thing")).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain('"p"');
    expect(line).toContain("custom:thing");
    expect(line).toContain("emits");
  });

  it("SP5 — warnings cap at 1 000 pairs, then one summary; dedupe set stays bounded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { emitter } = fakeHost({ p: undefined });
    const emit = emitter("p", send);
    for (let i = 1; i <= 5_000; i++) expect(emit(`t${i}`)).toBe(false);
    for (let i = 0; i < 100; i++) expect(emit(`later${i}`)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1_001);
    const summary = String(warn.mock.calls[1_000]![0]);
    expect(summary).toContain('"p"');
    expect(summary).toContain("1000");
    // nothing further after the summary
    warn.mockClear();
    expect(emit("t1")).toBe(false);
    expect(emit("brand-new")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("SX7 — one warning per (plugin, type), reserved names the prefix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn(() => true);
    const { emitter } = fakeHost({ A: undefined, B: undefined });
    const a = emitter("A", send);
    const b = emitter("B", send);
    for (let i = 0; i < 3; i++) a("x");
    b("x");
    for (let i = 0; i < 2; i++) a("y");
    for (let i = 0; i < 2; i++) a("roles:set");
    expect(send).not.toHaveBeenCalled();
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(4);
    const find = (plugin: string, type: string) => lines.filter((l) => l.includes(`from "${plugin}"`) && l.includes(`event type "${type}"`));
    expect(find("A", "x")).toHaveLength(1);
    expect(find("B", "x")).toHaveLength(1);
    expect(find("A", "y")).toHaveLength(1);
    const reserved = find("A", "roles:set");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toContain('"roles:"');
    for (const l of [...find("A", "x"), ...find("B", "x"), ...find("A", "y")]) expect(l).toContain("emits");
  });
});
