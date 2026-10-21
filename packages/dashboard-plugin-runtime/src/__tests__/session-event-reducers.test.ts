/**
 * Session event reducer slice + tool-row finalizer registry (design D5 item 6):
 * registration by plugin id, event-type matching, and the enabled-set filter
 * shared with slot claims.
 *
 * See change: decouple-plugins-from-core (task 4.2).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSessionReducersForTests,
  findSessionEventReducer,
  findToolRowFinalizer,
  registerSessionEventReducer,
  registerToolRowFinalizer,
  setSessionReducerEnabledSet,
  unregisterSessionReducers,
} from "../session-event-reducers.js";

const slice = (...eventTypes: string[]) => ({ eventTypes, reduce: <S,>(state: S) => state });

beforeEach(() => __resetSessionReducersForTests());

describe("session event reducer slices", () => {
  it("matches exact names and prefix_* globs, and nothing else", () => {
    const a = slice("subagent_started", "task_*");
    registerSessionEventReducer("p", a);
    expect(findSessionEventReducer("subagent_started")).toBe(a);
    expect(findSessionEventReducer("task_done")).toBe(a);
    expect(findSessionEventReducer("subagent_completed")).toBeUndefined();
    expect(findSessionEventReducer("taskdone")).toBeUndefined();
  });

  it("re-registering a plugin id replaces its slice (one slice per plugin)", () => {
    registerSessionEventReducer("p", slice("a"));
    const b = slice("b");
    registerSessionEventReducer("p", b);
    expect(findSessionEventReducer("a")).toBeUndefined();
    expect(findSessionEventReducer("b")).toBe(b);
  });

  it("is filtered by the enabled set exactly like claims: inactive until set, then plugin-scoped", () => {
    const s = slice("x");
    registerSessionEventReducer("p", s);
    expect(findSessionEventReducer("x")).toBe(s); // no set yet = filter inactive
    setSessionReducerEnabledSet(new Set(["other"]));
    expect(findSessionEventReducer("x")).toBeUndefined();
    setSessionReducerEnabledSet(new Set(["p"]));
    expect(findSessionEventReducer("x")).toBe(s);
    setSessionReducerEnabledSet(null);
    expect(findSessionEventReducer("x")).toBe(s);
  });

  it("unregister drops a plugin's slice and finalizers", () => {
    registerSessionEventReducer("p", slice("x"));
    registerToolRowFinalizer("p", { toolName: "Agent" });
    unregisterSessionReducers("p");
    expect(findSessionEventReducer("x")).toBeUndefined();
    expect(findToolRowFinalizer("Agent")).toBeUndefined();
  });
});

describe("tool-row finalizers", () => {
  it("resolves by tool name, honours the enabled set, and keeps one entry per (plugin, tool)", () => {
    const f1 = { toolName: "Agent" };
    const f2 = { toolName: "Agent", onToolExecution: <S,>(s: S) => s };
    registerToolRowFinalizer("p", f1);
    registerToolRowFinalizer("p", f2);
    expect(findToolRowFinalizer("Agent")).toBe(f2);
    expect(findToolRowFinalizer("bash")).toBeUndefined();
    setSessionReducerEnabledSet(new Set());
    expect(findToolRowFinalizer("Agent")).toBeUndefined();
  });
});
