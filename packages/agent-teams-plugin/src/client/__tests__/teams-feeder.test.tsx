// @vitest-environment jsdom
/**
 * TeamsFeeder (test-plan S48 StrictMode, S57 reset ≠ state change, plus the
 * frame/reconnect wiring of S31/S50): the render-less bridge between the shell's
 * React hooks and the module-level teams store.
 * See change: add-agent-teams-ui.
 */

import { clearSessionEvents, PluginContextProvider, publishSessionEvent } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionEventsStoreForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, render } from "@testing-library/react";
import { type ReactElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotEtag } from "../../shared/ui-protocol.js";
import { frameOf, TeamsFeeder } from "../teams-feeder.js";
import { createTeamsStore, type TeamsStore } from "../teams-store.js";
import { makeSnapshot } from "./fixtures.js";

type Status = "connecting" | "connected" | "disconnected" | "offline" | "auth_required";

let rev = 41;
let epoch = "E";
let lookupLead: string | undefined;
const gets: Array<{ url: string; inm?: string }> = [];
let store: TeamsStore;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const inm = new Headers(init?.headers).get("if-none-match") ?? undefined;
  gets.push({ url, inm });
  if (url.includes("?sessionId=")) return new Response(JSON.stringify({ teams: [{ id: "t1", ...(lookupLead ? { leadSessionId: lookupLead } : {}) }] }), { status: 200 });
  if (inm === snapshotEtag(epoch, rev)) return new Response(null, { status: 304 });
  return new Response(JSON.stringify(makeSnapshot({ epoch, rev })), { status: 200 });
});
const snapshotGets = () => gets.filter((g) => /\/teams\/t1$/.test(g.url));
const frame = (r: number, e = "E", teamId = "t1", closed?: true) => ({
  seq: r,
  timestamp: new Date(r).toISOString(),
  eventType: "agent-teams:changed",
  data: { teamId, epoch: e, rev: r, ...(closed ? { closed } : {}) },
});
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function mount(status: Status = "connected", strict = false, props: Partial<Parameters<typeof TeamsFeeder>[0]> = {}) {
  const tree = (s: Status): ReactElement => {
    const inner = (
      <PluginContextProvider connectionStatus={s}>
        <TeamsFeeder sessionId="LEAD" store={store} {...props} />
      </PluginContextProvider>
    );
    return strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  const r = render(tree(status));
  return { ...r, setStatus: (s: Status) => r.rerender(tree(s)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  rev = 41;
  epoch = "E";
  lookupLead = undefined;
  gets.length = 0;
  fetchMock.mockClear();
  store = createTeamsStore({ fetch: fetchMock as unknown as typeof fetch });
  __resetSessionEventsStoreForTests();
});
afterEach(() => {
  cleanup();
  store.dispose();
  __resetSessionEventsStoreForTests();
  vi.useRealTimers();
});

describe("frameOf", () => {
  it("accepts only a well-formed agent-teams:changed payload for the team", () => {
    expect(frameOf(frame(5), "t1")).toEqual({ epoch: "E", rev: 5 });
    expect(frameOf(frame(5, "E", "t1", true), "t1")).toEqual({ epoch: "E", rev: 5, closed: true });
    expect(frameOf(frame(5, "E", "other"), "t1")).toBeUndefined();
    expect(frameOf({ eventType: "tool_start", data: frame(5).data }, "t1")).toBeUndefined();
    for (const data of [null, undefined, "x", {}, { teamId: "t1" }, { teamId: "t1", epoch: 1, rev: 2 }, { teamId: "t1", epoch: "E", rev: "2" }, { teamId: "t1", epoch: "E", rev: Number.NaN }]) {
      expect(frameOf({ eventType: "agent-teams:changed", data }, "t1")).toBeUndefined();
    }
  });
});

describe("StrictMode (S48)", () => {
  it("one initial lookup + one snapshot GET (not two); one 60 s timer and one visibility listener live", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    mount("connected", true);
    await advance(0);
    expect(gets.filter((g) => g.url.includes("?sessionId="))).toHaveLength(1);
    expect(snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(41);
    expect(vi.getTimerCount()).toBe(1);
    const live = add.mock.calls.filter((c) => c[0] === "visibilitychange").length - remove.mock.calls.filter((c) => c[0] === "visibilitychange").length;
    expect(live).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("after unmount: 0 timers, 0 listeners, no later request, no setState-after-unmount warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const view = mount("connected", true);
    await advance(0);
    const before = gets.length;
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    const live = add.mock.calls.filter((c) => c[0] === "visibilitychange").length - remove.mock.calls.filter((c) => c[0] === "visibilitychange").length;
    expect(live).toBe(0);
    await advance(10 * 60_000);
    expect(gets).toHaveLength(before);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("teammate view subscribes to the lead's frames (leadSessionId from the lookup)", () => {
  it("a frame on the lead session reaches the store while the route session is a teammate; frames on the teammate session are not read", async () => {
    lookupLead = "REAL-LEAD";
    mount("connected", false, { sessionId: "MATE" });
    await advance(0);
    gets.length = 0;
    rev = 42;
    publishSessionEvent("MATE", frame(42) as never);
    await advance(5000);
    expect(snapshotGets()).toHaveLength(0);
    publishSessionEvent("REAL-LEAD", frame(42) as never);
    await advance(500);
    expect(snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(42);
  });

  it("an explicit leadSessionId prop wins; without any lead id the route session is used (lead's own view)", async () => {
    lookupLead = "REAL-LEAD";
    mount("connected", false, { sessionId: "MATE", leadSessionId: "PROP-LEAD" });
    await advance(0);
    gets.length = 0;
    rev = 43;
    publishSessionEvent("REAL-LEAD", frame(43) as never);
    await advance(5000);
    expect(snapshotGets()).toHaveLength(0);
    publishSessionEvent("PROP-LEAD", frame(43) as never);
    await advance(500);
    expect(snapshotGets()).toHaveLength(1);
  });
});

describe("frames", () => {
  it("a newer frame on the lead session's events triggers ONE debounced refetch; known frames do nothing", async () => {
    mount();
    await advance(0);
    gets.length = 0;
    rev = 42;
    publishSessionEvent("LEAD", frame(40) as never);
    publishSessionEvent("LEAD", frame(41) as never);
    await advance(5000);
    expect(snapshotGets()).toHaveLength(0);
    publishSessionEvent("LEAD", frame(42) as never);
    await advance(499);
    expect(snapshotGets()).toHaveLength(0);
    await advance(1);
    expect(snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(42);
  });

  it("a frame of another team, or another event type, is ignored", async () => {
    mount();
    await advance(0);
    gets.length = 0;
    publishSessionEvent("LEAD", frame(99, "E", "other") as never);
    publishSessionEvent("LEAD", { seq: 1, timestamp: "x", eventType: "tool_start", data: frame(99).data } as never);
    await advance(10_000);
    expect(snapshotGets()).toHaveLength(0);
  });

  it("reads the lead session's events when the viewed session is a teammate (`leadSessionId`)", async () => {
    mount("connected", false, { sessionId: "MATE", leadSessionId: "LEAD" });
    await advance(0);
    gets.length = 0;
    rev = 50;
    publishSessionEvent("MATE", frame(50) as never); // not the lead: nothing
    await advance(2000);
    expect(snapshotGets()).toHaveLength(0);
    publishSessionEvent("LEAD", frame(50) as never);
    await advance(500);
    expect(snapshotGets()).toHaveLength(1);
  });

  it("frames already in the array at mount time do not cause a request storm (≤ the first-use GET)", async () => {
    for (let r = 1; r <= 41; r++) publishSessionEvent("LEAD", frame(r) as never);
    mount();
    await advance(5000);
    expect(snapshotGets()).toHaveLength(1);
  });
});

describe("reconnect", () => {
  it("connected → disconnected → connected refetches exactly once", async () => {
    const view = mount("connected");
    await advance(0);
    gets.length = 0;
    view.setStatus("disconnected");
    await advance(1000);
    expect(gets).toHaveLength(0);
    view.setStatus("connected");
    await advance(500);
    expect(snapshotGets()).toHaveLength(1);
  });

  it("a flapping socket (3 reconnects in 400 ms) yields one refetch", async () => {
    const view = mount("connected");
    await advance(0);
    gets.length = 0;
    for (let i = 0; i < 3; i++) {
      view.setStatus("disconnected");
      await advance(66);
      view.setStatus("connected");
      await advance(66);
    }
    await advance(5000);
    expect(snapshotGets()).toHaveLength(1);
  });

  it("the first `connecting → connected` of a fresh page is not a reconnect (no extra refetch)", async () => {
    const view = mount("connecting");
    await advance(0);
    gets.length = 0;
    view.setStatus("connected");
    await advance(5000);
    expect(gets).toHaveLength(0);
  });
});

describe("events reset is not a state change (S57)", () => {
  it("the cached snapshot stays (same reference), replayed lower-rev frames do not regress, the next trigger refreshes", async () => {
    mount();
    await advance(0);
    const ref = store.getTeam("t1");
    expect(ref?.phase).toBe("ready");
    publishSessionEvent("LEAD", frame(41) as never);
    clearSessionEvents("LEAD"); // session_state_reset
    await advance(0);
    expect(store.getTeam("t1")).toBe(ref); // no skeleton, no blank
    gets.length = 0;
    // backfill re-delivers older frames
    for (let r = 30; r <= 41; r++) publishSessionEvent("LEAD", frame(r) as never);
    await advance(5000);
    expect(snapshotGets()).toHaveLength(0);
    expect(store.getTeam("t1")).toBe(ref);
    // the next real change refreshes it
    rev = 42;
    publishSessionEvent("LEAD", frame(42) as never);
    await advance(500);
    expect(snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(42);
  });
});
