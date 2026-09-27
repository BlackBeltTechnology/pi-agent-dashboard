/**
 * Pure settings-model helpers: usability, override seeding, chain edits.
 * See change: add-system-one-registry.
 */
import { describe, expect, it } from "vitest";
import type { BackendView, Draft } from "../api.js";
import { move, seedOverride, unusableReason, withOverride, withPresetChain } from "../model.js";

const caps = (ctx: number | null) => ({ maxContextTokens: ctx, maxOptions: null, languages: null, primitives: null });
const view = (over: Partial<BackendView> = {}): BackendView => ({
  capabilities: caps(null),
  offMachine: false,
  egress: "loopback",
  keyRef: null,
  languageLabel: null,
  priceUsdPerMTok: null,
  managed: null,
  ...over,
});
const draft: Draft = {
  allowOffMachine: false,
  backends: { von: { kind: "managed", engine: "von" }, laya: { kind: "managed", engine: "laya" }, jev: { kind: "http", url: "https://x", model: "jev-1.13.0" } },
  presets: { p: { chain: ["von", "laya"] } },
  activePreset: "p",
};
const views = { von: view({ capabilities: caps(8192) }), laya: view({ capabilities: caps(1024) }), jev: view({ offMachine: true, egress: "hosted" }) };

describe("unusableReason", () => {
  it("off-machine only while the switch is off", () => {
    expect(unusableReason("jev", draft, views)).toBe("off-machine");
    expect(unusableReason("jev", { ...draft, allowOffMachine: true }, views)).toBeNull();
  });
  it("runtime when the managed launcher is missing", () => {
    expect(unusableReason("von", draft, { ...views, von: view({ managed: { state: "unavailable" } }) })).toBe("runtime");
  });
  it("an unsaved backend is not assumed on-machine", () => {
    expect(unusableReason("new", draft, views)).toBe("not-saved");
  });
});

describe("seedOverride (spec: override seeding drops incompatible backends)", () => {
  it("starts from the preset chain minus backends the consumer cannot use", () => {
    expect(seedOverride(["von", "laya"], { id: "c", failurePolicy: "fail-open", requires: { minContextTokens: 4000 } }, views)).toEqual(["von"]);
    expect(seedOverride(["von", "laya"], { id: "c", failurePolicy: "fail-open" }, views)).toEqual(["von", "laya"]);
  });
});

describe("chain edits", () => {
  it("move clamps at the boundaries", () => {
    expect(move(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
  it("withPresetChain / withOverride touch only the active preset", () => {
    const d1 = withPresetChain(draft, ["laya"]);
    expect(d1.presets.p.chain).toEqual(["laya"]);
    const d2 = withOverride(d1, "c", ["von"]);
    expect(d2.presets.p.consumers?.c.chain).toEqual(["von"]);
    expect(withOverride(d2, "c", null).presets.p.consumers).toEqual({});
    expect(draft.presets.p.chain).toEqual(["von", "laya"]);
  });
});
