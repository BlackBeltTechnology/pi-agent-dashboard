/**
 * Device-status limiter (test-plan E5) and the revoked-answer log throttle (E17).
 * See change: device-key-mutual-check (D2, D10).
 */
import { describe, expect, it } from "vitest";
import { DEVICE_STATUS_MAX_PEERS, DeviceStatusLimiter, RevokedAnswerLog } from "../auth/device-proof.js";

function mk(opts: { maxPeers?: number } = {}) {
  let t = 1_000_000;
  const trips: string[] = [];
  const limiter = new DeviceStatusLimiter({ now: () => t, onTrip: (p) => trips.push(p), ...opts });
  return { limiter, trips, advance: (ms: number) => (t += ms) };
}

describe("DeviceStatusLimiter", () => {
  it("allows 60 per minute per peer and blocks the 61st", () => {
    const { limiter } = mk();
    for (let i = 0; i < 60; i += 1) expect(limiter.allow("192.168.16.31")).toBe(true);
    expect(limiter.allow("192.168.16.31")).toBe(false);
  });

  it("59 requests stay within the budget", () => {
    const { limiter } = mk();
    for (let i = 0; i < 59; i += 1) expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
  });

  it("peers have independent budgets", () => {
    const { limiter } = mk();
    for (let i = 0; i < 61; i += 1) limiter.allow("a");
    expect(limiter.allow("b")).toBe(true);
  });

  it("slides: recovers one window after the first request", () => {
    const { limiter, advance } = mk();
    for (let i = 0; i < 61; i += 1) limiter.allow("a");
    advance(61_000);
    expect(limiter.allow("a")).toBe(true);
  });

  it("logs exactly one line per peer when it trips, again after recovering and re-tripping", () => {
    const { limiter, trips, advance } = mk();
    for (let i = 0; i < 1000; i += 1) limiter.allow("a");
    expect(trips).toEqual(["a"]);
    advance(61_000);
    for (let i = 0; i < 100; i += 1) limiter.allow("a");
    expect(trips).toEqual(["a", "a"]);
    for (let i = 0; i < 100; i += 1) limiter.allow("b");
    expect(trips).toEqual(["a", "a", "b"]);
  });

  it("bounds the peer map at 1024, evicting the oldest with a fresh budget", () => {
    expect(DEVICE_STATUS_MAX_PEERS).toBe(1024);
    const { limiter } = mk();
    for (let i = 0; i < 60; i += 1) limiter.allow("P1");
    expect(limiter.allow("P1")).toBe(false);
    for (let i = 2; i <= 1025; i += 1) limiter.allow(`P${i}`);
    expect(limiter.size()).toBe(1024);
    expect(limiter.allow("P1")).toBe(true);
  });

  it("a throwing log sink does not change the answer", () => {
    const limiter = new DeviceStatusLimiter({ onTrip: () => { throw new Error("sink"); } });
    for (let i = 0; i < 60; i += 1) limiter.allow("a");
    expect(limiter.allow("a")).toBe(false);
  });
});

describe("RevokedAnswerLog", () => {
  function mkLog() {
    let t = 0;
    const lines: string[] = [];
    const log = new RevokedAnswerLog({ now: () => t, emit: (k) => lines.push(k) });
    return { log, lines, set: (ms: number) => (t = ms) };
  }

  it("logs the first revoked answer, not each of 100", () => {
    const { log, lines } = mkLog();
    for (let i = 0; i < 100; i += 1) log.note("dk:aaaaaaaaaaaa", "revoked");
    expect(lines).toEqual(["dk:aaaaaaaaaaaa"]);
  });

  it("never logs expired / paired / unknown answers", () => {
    const { log, lines } = mkLog();
    for (let i = 0; i < 100; i += 1) log.note("dk:aaaaaaaaaaaa", "expired");
    log.note("dk:aaaaaaaaaaaa", "paired");
    log.note("dk:aaaaaaaaaaaa", "unknown");
    expect(lines).toEqual([]);
  });

  it("a transition back to revoked logs again only after 10 minutes", () => {
    const { log, lines, set } = mkLog();
    log.note("dk:a", "paired");
    log.note("dk:a", "revoked"); // line 1
    set(9 * 60_000 + 59_000);
    log.note("dk:a", "paired");
    log.note("dk:a", "revoked");
    expect(lines).toHaveLength(1);
    set(10 * 60_000 + 1_000);
    log.note("dk:a", "paired");
    log.note("dk:a", "revoked");
    expect(lines).toHaveLength(2);
  });

  it("another key id has its own line", () => {
    const { log, lines } = mkLog();
    log.note("dk:a", "revoked");
    log.note("dk:b", "revoked");
    expect(lines).toEqual(["dk:a", "dk:b"]);
  });
});
