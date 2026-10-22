/**
 * Close-risk predicates: unknown dirty state is risky for single close only;
 * bulk plan dedupes per instance and counts the tabs kept.
 * See change: scope-anchor-editor-pane-controls (D6; test-plan #E3, #E4).
 */
import { describe, expect, it } from "vitest";
import type { OpenFile } from "../../../../lib/layout/editor-pane-state.js";
import { type CloseRiskLookups, handlerCloseRisk, planBulkClose } from "../close-risk.js";
import type { HandlerDirtyState } from "../file-handler-store.js";

const tab = (path: string, viewer: OpenFile["viewer"] = "monaco"): OpenFile => ({ path, viewer, addedAt: 1 });

/** Handler key = `h:<path>` for paths in `handlers`; instance state from `states`. */
const lookups = (handlers: string[], states: Record<string, HandlerDirtyState>): CloseRiskLookups => ({
  keyOf: (t) => (handlers.includes(t.path) ? `h:${t.path}` : null),
  getInstance: (k) => (k in states ? { dirty: states[k] } : undefined),
});

describe("handlerCloseRisk (#E3)", () => {
  const cases: Array<[string, boolean | "unknown" | "none" | "nokey", boolean, "unsaved" | null]> = [
    ["no handler key", "nokey", true, null],
    ["no handler key, flag off", "nokey", false, null],
    ["instance missing / evicted", "none", true, null],
    ["clean", false, true, null],
    ["dirty, flag on", true, true, "unsaved"],
    ["dirty, flag off", true, false, "unsaved"],
    ["unknown, flag on", "unknown", true, "unsaved"],
    ["unknown, flag off", "unknown", false, null],
  ];
  it.each(cases)("%s", (_name, state, unknownIsRisky, expected) => {
    const t = tab("x.docx");
    const l = lookups(state === "nokey" ? [] : ["x.docx"], state === "none" || state === "nokey" ? {} : { "h:x.docx": state });
    expect(handlerCloseRisk(t, [], l, { unknownIsRisky })).toBe(expected);
  });

  it("a remaining tab sharing the instance exempts the close", () => {
    const l: CloseRiskLookups = { keyOf: () => "same", getInstance: () => ({ dirty: true }) };
    expect(handlerCloseRisk(tab("a"), [tab("b")], l, { unknownIsRisky: true })).toBeNull();
  });
});

describe("planBulkClose (#E4)", () => {
  const tabs = [tab("a.ts"), tab("term:t1", "terminal"), tab("memo.pdf"), tab("x.docx"), tab("b.ts")];
  const l = lookups(["memo.pdf", "x.docx"], { "h:memo.pdf": true, "h:x.docx": "unknown" });

  it("lists terminals and unsaved handlers; unknown stays silent; kept count = risky tabs", () => {
    const plan = planBulkClose(tabs, tabs.map((t) => t.path), l);
    expect(plan.risky).toEqual([
      { kind: "terminal", id: "t1", reason: "terminal", tabPaths: ["term:t1"] },
      { kind: "handler", key: "h:memo.pdf", reason: "unsaved", tabPaths: ["memo.pdf"] },
    ]);
    expect(plan.keptCount).toBe(2);
    expect(plan.targets).toEqual(tabs.map((t) => t.path));
  });

  it("a partial target set only sees its own tabs; ignores unknown paths", () => {
    const plan = planBulkClose(tabs, ["a.ts", "nope"], l);
    expect(plan.targets).toEqual(["a.ts"]);
    expect(plan.risky).toEqual([]);
  });

  it("a handler instance kept alive by a non-target tab is not risky", () => {
    const shared: CloseRiskLookups = { keyOf: (t) => (t.path.startsWith("m") ? "k" : null), getInstance: () => ({ dirty: true }) };
    const plan = planBulkClose([tab("m1"), tab("m2")], ["m1"], shared);
    expect(plan.risky).toEqual([]);
  });

  it("dedupes tabs of one instance into one entry", () => {
    const shared: CloseRiskLookups = { keyOf: (t) => (t.path.startsWith("m") ? "k" : null), getInstance: () => ({ dirty: true }) };
    const plan = planBulkClose([tab("m1"), tab("m2")], ["m1", "m2"], shared);
    expect(plan.risky).toEqual([{ kind: "handler", key: "k", reason: "unsaved", tabPaths: ["m1", "m2"] }]);
    expect(plan.keptCount).toBe(2);
  });
});
