/**
 * Rate-limited, secret-free logger for otherwise-silent WS upgrade rejections
 * (test-plan #E12–#E15).
 *
 * See change: harden-ios-safari-memory-and-ws-diagnostics (design D4).
 */
import { describe, expect, it } from "vitest";
import { createWsUpgradeRejectLogger } from "../auth/ws-upgrade-reject-log.js";

function harness(opts: { windowMs?: number; maxKeys?: number } = {}) {
  const lines: string[] = [];
  let t = 0;
  const logger = createWsUpgradeRejectLogger({
    ...opts,
    now: () => t,
    log: (l: string) => lines.push(l),
  });
  return { lines, logger, setNow: (ms: number) => { t = ms; } };
}

describe("header names only, never values (test-plan #E12)", () => {
  it("names forwarding headers and omits their values and cookies", () => {
    const { lines, logger } = harness();
    logger.log({
      status: 403,
      scope: "browser",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.9", cookie: "sid=SECRET" },
      ticketPresent: false,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[ws-upgrade] rejected status=403 scope=browser peer=127.0.0.1 fwd=x-forwarded-for ticket=absent");
    expect(lines[0]).not.toContain("203.0.113.9");
    expect(lines[0]).not.toContain("SECRET");
  });

  it("reports fwd=none when no forwarding header is present", () => {
    const { lines, logger } = harness();
    logger.log({ status: 403, scope: "browser", remoteAddress: "127.0.0.1", headers: {}, ticketPresent: false });
    expect(lines[0]).toContain("fwd=none");
  });
});

describe("ticket presence, never value (test-plan #E13)", () => {
  it("reports ticket=present and omits the ticket string", () => {
    const { lines, logger } = harness();
    logger.log({
      status: 401,
      scope: "browser",
      remoteAddress: "10.0.0.2",
      headers: { "sec-websocket-protocol": "pi-ticket.tkt-abcdef123" },
      ticketPresent: true,
    });
    expect(lines[0]).toContain("ticket=present");
    expect(lines[0]).not.toContain("tkt-abcdef123");
  });
});

describe("rate limit window (test-plan #E14)", () => {
  it("logs once per key per 60 s window and reports the suppressed count", () => {
    const { lines, logger, setNow } = harness();
    const rej = { status: 403, scope: "browser", remoteAddress: "127.0.0.1", headers: {}, ticketPresent: false };
    for (let i = 0; i < 20; i++) {
      setNow(Math.floor((i * 59_000) / 19)); // t = 0 .. 59 s
      logger.log(rej);
    }
    setNow(60_000);
    logger.log(rej);
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toContain("suppressed=");
    expect(lines[1]).toContain("suppressed=19");
  });
});

describe("bounded state (test-plan #E15)", () => {
  it("tracks at most 256 keys across 1000 distinct peers", () => {
    const { logger } = harness();
    for (let i = 0; i < 1000; i++) {
      logger.log({ status: 403, scope: "browser", remoteAddress: `10.0.${i >> 8}.${i & 255}`, headers: {}, ticketPresent: false });
    }
    expect(logger.trackedKeys()).toBeLessThanOrEqual(256);
  });
});
