/**
 * makeFlowsForCwd: resolves a folder cwd to the live per-session flows list
 * (stateStore, populated by the forwarded flows_list). Reflects package/event
 * flows a static disk scan would miss; empty with no matching running session.
 * See change: fix-automation-flow-detection.
 */

import { describe, expect, it } from "vitest";
import { makeFlowsForCwd } from "../server/index.js";

function store(byId: Record<string, string[]>) {
  return {
    getState(id: string) {
      const names = byId[id];
      return names ? { flows: names.map((name) => ({ name })) } : undefined;
    },
  };
}

describe("makeFlowsForCwd", () => {
  it("returns the running session's flows for a matching cwd (package/event flows included)", () => {
    const sm = { listActive: () => [{ id: "s1", cwd: "/w/invoice-bot" }] };
    const resolve = makeFlowsForCwd(sm, store({ s1: ["invoicebot:pull", "invoicebot:process"] }));
    expect(resolve("/w/invoice-bot")).toEqual(["invoicebot:process", "invoicebot:pull"]);
  });

  it("returns [] when no active session matches the cwd", () => {
    const sm = { listActive: () => [{ id: "s1", cwd: "/w/other" }] };
    const resolve = makeFlowsForCwd(sm, store({ s1: ["a:b"] }));
    expect(resolve("/w/invoice-bot")).toEqual([]);
  });

  it("unions + de-dupes + sorts across multiple sessions in the same cwd", () => {
    const sm = {
      listActive: () => [
        { id: "s1", cwd: "/w/x" },
        { id: "s2", cwd: "/w/x" },
      ],
    };
    const resolve = makeFlowsForCwd(sm, store({ s1: ["ns:b", "ns:a"], s2: ["ns:a", "ns:c"] }));
    expect(resolve("/w/x")).toEqual(["ns:a", "ns:b", "ns:c"]);
  });

  it("tolerates malformed session entries and missing state", () => {
    const sm = {
      listActive: () => [null, { cwd: "/w/x" }, { id: 7, cwd: "/w/x" }, { id: "s1", cwd: "/w/x" }],
    };
    const resolve = makeFlowsForCwd(sm, store({})); // s1 has no state
    expect(resolve("/w/x")).toEqual([]);
  });
});
