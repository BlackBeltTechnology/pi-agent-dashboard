// @vitest-environment jsdom
/**
 * Reconnect storm / replay (test-plan S50): a WS reconnect replays 7 200 old
 * `agent-teams:changed` frames (same epoch, ascending rev) and a flapping socket
 * reconnects three times in 400 ms. The whole replay costs ≤ 1 GET (debounce +
 * single-flight) and no per-frame re-render storm reaches a view.
 * See change: add-agent-teams-ui.
 */

import { PluginContextProvider, publishSessionEvents } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionEventsStoreForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotEtag } from "../../shared/ui-protocol.js";
import { TeamsFeeder } from "../teams-feeder.js";
import { useTeamEntry } from "../teams-hooks.js";
import { createTeamsStore, type TeamsStore } from "../teams-store.js";
import { makeSnapshot } from "./fixtures.js";

type Status = "connecting" | "connected" | "disconnected" | "offline" | "auth_required";

const REPLAY = 7200;
let rev = 41;
let store: TeamsStore;
const gets: string[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  gets.push(url);
  if (url.includes("?sessionId=")) return new Response(JSON.stringify({ teams: [{ id: "t1" }] }), { status: 200 });
  const inm = new Headers(init?.headers).get("if-none-match");
  if (inm === snapshotEtag("E", rev)) return new Response(null, { status: 304 });
  return new Response(JSON.stringify(makeSnapshot({ epoch: "E", rev })), { status: 200 });
});

let renders = 0;
function Probe(): null {
  useTeamEntry("t1", store);
  renders += 1;
  return null;
}

const frames = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    seq: from + i,
    timestamp: new Date(from + i).toISOString(),
    eventType: "agent-teams:changed",
    data: { teamId: "t1", epoch: "E", rev: from + i },
  }));

beforeEach(() => {
  vi.useFakeTimers();
  rev = 41;
  gets.length = 0;
  renders = 0;
  store = createTeamsStore({ fetch: fetchMock as unknown as typeof fetch });
  __resetSessionEventsStoreForTests();
});
afterEach(() => {
  cleanup();
  store.dispose();
  __resetSessionEventsStoreForTests();
  vi.useRealTimers();
});

describe("reconnect storm / replay (S50)", () => {
  it("7 200 replayed frames + a flapping socket cost ≤ 1 snapshot GET and no per-frame re-render storm", async () => {
    const tree = (s: Status) => (
      <PluginContextProvider connectionStatus={s}>
        <TeamsFeeder sessionId="LEAD" store={store} />
        <Probe />
      </PluginContextProvider>
    );
    const view = render(tree("connected"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(41);
    gets.length = 0;
    renders = 0;

    rev = 41 + REPLAY;
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        view.rerender(tree("disconnected"));
        await vi.advanceTimersByTimeAsync(66);
        view.rerender(tree("connected"));
        await vi.advanceTimersByTimeAsync(66);
      }
      publishSessionEvents("LEAD", frames(42, 41 + REPLAY) as never); // the backfill, one burst
    });
    await vi.advanceTimersByTimeAsync(10_000);

    const snapshotGets = gets.filter((u) => /\/teams\/t1$/.test(u));
    expect(snapshotGets.length).toBeLessThanOrEqual(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(41 + REPLAY);
    // the probe re-renders only when its cache entry changes (status flaps and frames never touch it)
    expect(renders).toBeLessThanOrEqual(6);
  });

  it("a replay of frames that are all ≤ the cached rev causes zero requests and zero view re-renders", async () => {
    rev = 7200;
    const view = render(
      <PluginContextProvider connectionStatus="connected">
        <TeamsFeeder sessionId="LEAD" store={store} />
        <Probe />
      </PluginContextProvider>,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(7200);
    gets.length = 0;
    renders = 0;
    await act(async () => publishSessionEvents("LEAD", frames(1, 7200) as never));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gets.filter((u) => /\/teams\/t1$/.test(u))).toHaveLength(0);
    expect(renders).toBe(0);
    view.unmount();
  });
});
