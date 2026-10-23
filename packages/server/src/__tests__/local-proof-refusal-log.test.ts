/**
 * The bounded REST refusal log for `local_proof_required`.
 * See change: close-container-loopback-impersonation (D6; test-plan #P1).
 */
import { describe, expect, it } from "vitest";
import { createLocalProofRefusalLogger, sanitizeForLog } from "../auth/local-proof-refusal-log.js";

function harness(maxKeys?: number) {
  let t = 1_000_000;
  const lines: string[] = [];
  const logger = createLocalProofRefusalLogger({ now: () => t, log: (l) => lines.push(l), ...(maxKeys ? { maxKeys } : {}) });
  return { logger, lines, advance: (ms: number) => void (t += ms) };
}

describe("P1 — a flood of refusals stays bounded and single-line", () => {
  it("10 000 refusals, random Host, 300 route patterns, one 60 s window: keys ≤ 256, lines ≤ distinct keys, no raw newline", () => {
    const { logger, lines, advance } = harness();
    const hosts = ["127.0.0.1:8000", "evil\r\nInjected: header", "a".repeat(5000), "\u0000\u001b[31mred", "host with spaces", "ünïcode"];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const routes = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const route = `/api/route-${Math.floor(rnd() * 300)}/:id`;
      routes.add(route);
      logger.log({
        peer: "127.0.0.1",
        host: i % 3 === 0 ? `h${Math.floor(rnd() * 1e9)}.example:${i}` : hosts[i % hosts.length],
        method: "POST",
        route,
        reason: "local_proof_required",
      });
      if (i % 50 === 0) advance(100); // 10 000 / 50 × 100 ms = 20 s: inside one 60 s window
    }
    expect(routes.size).toBeGreaterThan(256);
    expect(logger.trackedKeys()).toBeLessThanOrEqual(256 + 1); // 256 route keys + the shared overflow bucket
    expect(lines.length).toBeLessThanOrEqual(routes.size);
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(line.startsWith("[local-proof] refused ")).toBe(true);
      expect(line.length).toBeLessThan(400);
    }
  });

  it("emits one line per key per window; the next window's line carries the suppressed count", () => {
    const { logger, lines, advance } = harness();
    const hit = () => logger.log({ peer: "127.0.0.1", host: "x", method: "POST", route: "/api/restart", reason: "local_proof_required" });
    hit();
    hit();
    hit();
    expect(lines).toHaveLength(1);
    advance(60_001);
    hit();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("suppressed=2");
  });

  it("an unmatched route is logged as a fixed token, not the raw URL", () => {
    const { logger, lines } = harness();
    logger.log({ peer: "127.0.0.1", host: "x", method: "GET", route: undefined, reason: "local_proof_required" });
    expect(lines[0]).toContain("route=<unmatched>");
  });
});

describe("sanitizeForLog", () => {
  it("replaces control, whitespace and non-ASCII bytes and caps the length", () => {
    expect(sanitizeForLog("a\r\nb c\u0000d")).toBe("a??b?c?d");
    expect(sanitizeForLog("x".repeat(100), 10)).toBe("xxxxxxxxxx...");
    expect(sanitizeForLog(undefined)).toBe("-");
  });
});
