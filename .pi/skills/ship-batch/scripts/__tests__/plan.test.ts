import { describe, expect, it } from "vitest";
import { nextActions, planQueue, resolveGroup } from "../scheduler.ts";
import { mkObs, mkState, T0 } from "./helpers.ts";

const base = { groupId: "g", now: T0, edges: {}, archiveDirs: [] as string[] };

describe("#E1 membership + order", () => {
  it("persisted order first, then in-progress -> others -> complete by name", () => {
    const r = planQueue({
      ...base,
      assignments: { a: "g", b: "g", c: "g", d: "g" },
      changeOrder: { g: ["b", "a"] },
      active: [
        { name: "a", status: "in-progress" },
        { name: "b", status: "in-progress" },
        { name: "c", status: "in-progress" },
        { name: "d", status: "complete" },
      ],
    });
    expect(r.items.map((i) => i.change)).toEqual(["b", "a", "c", "d"]);
  });
  it("ignores other groups' members and stale order entries", () => {
    const r = planQueue({
      ...base,
      assignments: { a: "g", x: "other" },
      changeOrder: { g: ["gone", "a"] },
      active: [
        { name: "a", status: "in-progress" },
        { name: "x", status: "in-progress" },
      ],
    });
    expect(r.items.map((i) => i.change)).toEqual(["a"]);
  });
});

describe("#E2 membership excludes shipped", () => {
  it("archived-locally is absent; archived on origin/develop is reported", () => {
    const r = planQueue({
      ...base,
      assignments: { a: "g", z: "g", y: "g" },
      active: [
        { name: "a", status: "in-progress" },
        { name: "y", status: "in-progress" },
      ],
      archiveDirs: ["2026-05-01-y"],
    });
    expect(r.items.map((i) => i.change)).toEqual(["a"]);
    expect(r.alreadyShipped).toEqual(["y"]);
  });
});

describe("#E3 group resolution", () => {
  const groups = [
    { id: "ui", name: "Current" },
    { id: "cur2", name: "current" },
    { id: "sec", name: "Harden Security" },
  ];
  it("resolves by id and by case-insensitive name", () => {
    expect(resolveGroup(groups, "sec")).toMatchObject({ ok: true, group: { id: "sec" } });
    expect(resolveGroup(groups, "harden security")).toMatchObject({ ok: true, group: { id: "sec" } });
  });
  it("ambiguous name lists the ids", () => {
    const r = resolveGroup(groups, "current");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/ui.*cur2/);
  });
  it("unknown lists every id", () => {
    const r = resolveGroup(groups, "nope");
    expect(r.ok ? "" : r.error).toMatch(/ui.*cur2.*sec/);
  });
});

describe("#E12 out-of-batch blocker", () => {
  const input = {
    ...base,
    assignments: { a: "g", b: "g" },
    active: [
      { name: "a", status: "in-progress" },
      { name: "b", status: "in-progress" },
    ],
    edges: { b: [{ change: "x", state: "open" as const }] },
  };
  it("is recorded as will-ask and does not gate", () => {
    const r = planQueue(input);
    const b = r.items.find((i) => i.change === "b");
    expect(b?.outOfBatch).toEqual(["x"]);
    expect(b?.blockedBy).toEqual([]);
    const state = mkState({});
    state.items = r.items;
    const actions = nextActions(state, mkObs(), T0);
    expect(actions.filter((a) => a.kind === "start").map((a) => a.change)).toEqual(["a", "b"]);
  });
  it("satisfied edges never gate", () => {
    const r = planQueue({ ...input, edges: { b: [{ change: "a", state: "satisfied" as const }] } });
    expect(r.items.find((i) => i.change === "b")?.blockedBy).toEqual([]);
  });
});

describe("#E13 in-batch cycle", () => {
  it("cycle members are skipped at plan time, free items stay queued", () => {
    const r = planQueue({
      ...base,
      assignments: { a: "g", b: "g", c: "g" },
      active: ["a", "b", "c"].map((name) => ({ name, status: "in-progress" })),
      edges: { a: [{ change: "b", state: "open" }], b: [{ change: "a", state: "open" }] },
    });
    const by = Object.fromEntries(r.items.map((i) => [i.change, i]));
    expect(by.a).toMatchObject({ state: "skipped", reason: "cycle" });
    expect(by.b).toMatchObject({ state: "skipped", reason: "cycle" });
    expect(by.c.state).toBe("queued");
  });
});
