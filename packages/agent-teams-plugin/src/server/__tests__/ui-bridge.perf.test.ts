/**
 * Frame-rate gates (test-plan S76, S80): a structural count, not wall-clock —
 * leading + trailing per team, ≤ 1 frame per team per 1000 ms, the first
 * mutation sent at t≈0, and ONE host broadcast per frame whatever the number of
 * browser sockets (the host serialises once; the plugin never fans out itself).
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createFakeUiHost } from "../../__tests__/harness/fake-ui-host.js";
import { createStoreEnv, FakeClock } from "../../__tests__/harness/index.js";
import { capturingLogger } from "../../__tests__/harness/store-env.js";
import { CHANGED_COALESCE_MS } from "../../shared/ui-protocol.js";
import { createUiBridge, type UiBridge } from "../ui-bridge.js";

const bridges: UiBridge[] = [];
afterEach(() => {
  for (const b of bridges.splice(0)) b.dispose();
});

function setup() {
  const env = createStoreEnv();
  const clock = new FakeClock(0);
  const host = createFakeUiHost();
  const times: Array<{ team: string; at: number; rev: number }> = [];
  const original = host.host.broadcastToSubscribers;
  host.host.broadcastToSubscribers = (msg: unknown) => {
    original(msg);
    const d = (msg as { event: { data: { teamId: string; rev: number } } }).event.data;
    times.push({ team: d.teamId, at: clock.now(), rev: d.rev });
  };
  bridges.push(createUiBridge({ store: env.store, host: host.host, epoch: "E", clock, logger: capturingLogger().logger }));
  return { env, clock, host, times };
}
const mail = (s: ReturnType<typeof setup>, id: string) => s.env.store.appendMail(id, { from: "lead", to: "alice", kind: "message", text: "x", wake: false });

describe("coalescing (S76)", () => {
  it("20 mutations in 100 ms → at most 2 frames: leading at t≈0, trailing ≤ +1000 ms carrying the latest rev", () => {
    const s = setup();
    const t = s.env.store.createTeam({ name: "a", leadSessionId: "S-a", leadCwd: "/w", mode: "session", maxTeammates: 4 });
    s.clock.advance(5000); // quiet
    s.times.length = 0;
    for (let i = 0; i < 20; i++) {
      mail(s, t.id);
      s.clock.advance(5);
    }
    s.clock.advance(CHANGED_COALESCE_MS);
    expect(s.times.length).toBeLessThanOrEqual(2);
    expect(s.times[0]?.at).toBe(5000); // leading: the first mutation, at t≈0 of the burst
    const last = s.times.at(-1);
    expect((last?.at ?? 0) - 5000).toBeLessThanOrEqual(CHANGED_COALESCE_MS);
    expect(last?.rev).toBe(s.env.store.rev(t.id));
  });

  it("1 mutation/s for 10 s → ≤ 1 frame per 1000 ms per team in an 11 s window; the first frame is at t≈0", () => {
    const s = setup();
    const t = s.env.store.createTeam({ name: "a", leadSessionId: "S-a", leadCwd: "/w", mode: "session", maxTeammates: 4 });
    for (let i = 0; i < 10; i++) {
      mail(s, t.id);
      s.clock.advance(1000);
    }
    s.clock.advance(1000);
    expect(s.times[0]?.at).toBe(0);
    expectSpacing(s.times);
    expect(s.times.length).toBeLessThanOrEqual(12);
    expect(s.times.at(-1)?.rev).toBe(s.env.store.rev(t.id));
  });
});

type Frame = { team: string; at: number; rev: number };

/** Consecutive frames of one team are at least one window apart. */
function expectSpacing(frames: readonly Frame[]): void {
  for (let i = 1; i < frames.length; i++) expect((frames[i]?.at as number) - (frames[i - 1]?.at as number)).toBeGreaterThanOrEqual(CHANGED_COALESCE_MS);
}

/** The most frames (all teams) inside any 1000 ms window sliding in 250 ms steps. */
function maxInWindow(frames: readonly Frame[], until: number): number {
  let max = 0;
  for (let start = 0; start < until; start += 250) max = Math.max(max, frames.filter((f) => f.at >= start && f.at < start + CHANGED_COALESCE_MS).length);
  return max;
}

type Setup = ReturnType<typeof setup>;
type TeamRef = { id: string };

function addMembers(s: Setup, teams: readonly TeamRef[]): void {
  for (const t of teams) for (let m = 0; m < 10; m++) s.env.store.reserveMember(t.id, { name: `m${m}`, spawnToken: "x", cwd: "/w", status: "busy", guardActive: true, noMcp: true, noContextFiles: true, lastSettleId: 0 });
}

/** One tick of continuous activity: a mail and a member status flip per team. */
function churn(s: Setup, teams: readonly TeamRef[], tick: number): void {
  for (const t of teams) {
    mail(s, t.id);
    s.env.store.patchMember(t.id, `m${tick % 10}`, { status: tick % 2 === 0 ? "idle" : "busy" });
  }
}

describe("fan-out (S80)", () => {
  it("5 teams × 10 members mutating continuously for 60 s: ≤ 1 frame per team per second (≤ 5/s overall), one host call per frame", () => {
    const s = setup();
    const teams = Array.from({ length: 5 }, (_, i) => s.env.store.createTeam({ name: `t${i}`, leadSessionId: `S-${i}`, leadCwd: "/w", mode: "session", maxTeammates: 10 }));
    addMembers(s, teams);
    s.times.length = 0;
    s.host.frames.length = 0;
    for (let tick = 0; tick < 600; tick++) {
      churn(s, teams, tick);
      s.clock.advance(100);
    }
    s.clock.advance(CHANGED_COALESCE_MS);
    expect(s.host.frames).toHaveLength(s.times.length); // exactly one broadcast per frame
    for (const t of teams) expectSpacing(s.times.filter((f) => f.team === t.id));
    expect(maxInWindow(s.times, 61_000)).toBeLessThanOrEqual(5); // at most one frame per team in any window
    expect(s.host.frames.length).toBeLessThanOrEqual(5 * 62); // 60 s: ≤ 1 per team per second plus the edges, whatever the number of sockets
  });
});
