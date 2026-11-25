/**
 * Retry policy decision (scenario-gate B15 / C1; test-plan B95, B96, B98): 3 attempts in total; without
 * `Retry-After` two waits of 500 ms then 1 000 ms with up to 25 % jitter; waits capped at 30 s; a `Retry-After`
 * beyond the cap fails at once as `rate_limited`. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { GoogleApi } from "../../bridge/google-http.js";
import { MAX_ATTEMPTS, MAX_WAIT_MS, nextDelay } from "../backoff.js";

const tooMany = (retryAfter?: string) => () => new Response("{}", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });
const ok = () => new Response("{}");

function api(responses: Array<() => Response>, random = () => 0) {
  const waits: number[] = [];
  let calls = 0;
  const fetchImpl = (async () => responses[Math.min(calls++, responses.length - 1)]?.()) as typeof fetch;
  return { waits, calls: () => calls, api: new GoogleApi({ product: "calendar", base: "https://x.example/", token: "T", fetchImpl, sleep: async (ms) => void waits.push(ms), random }) };
}

describe("GB15 retry counting and delay", () => {
  it("is 3 attempts in total", async () => {
    expect(MAX_ATTEMPTS).toBe(3);
    const t = api([tooMany(), tooMany(), tooMany(), ok]);
    await expect(t.api.request("GET", "events")).rejects.toBeDefined();
    expect(t.calls()).toBe(3);
  });

  it("without Retry-After waits 500 ms then 1 000 ms (no jitter at random=0), at most +25 % with jitter", async () => {
    const plain = api([tooMany(), tooMany(), ok]);
    await plain.api.request("GET", "events");
    expect(plain.waits).toEqual([500, 1000]);
    const jittered = api([tooMany(), tooMany(), ok], () => 1);
    await jittered.api.request("GET", "events");
    expect(jittered.waits).toEqual([625, 1250]);
  });

  it("honours a Retry-After up to 30 s; waits are capped at 30 s", async () => {
    expect(nextDelay(1, 30_000)).toEqual({ delayMs: 30_000 });
    expect(nextDelay(1, 7_000)).toEqual({ delayMs: 7_000 });
    for (const attempt of [1, 2, 3, 10, 40]) {
      const d = nextDelay(attempt, undefined, () => 1);
      expect("delayMs" in d && d.delayMs <= MAX_WAIT_MS).toBe(true);
    }
  });

  it("a Retry-After longer than 30 s fails at once with `rate_limited` — no wait, no second attempt", async () => {
    const t = api([tooMany("31"), ok]);
    await expect(t.api.request("GET", "events")).rejects.toMatchObject({ code: "rate_limited" });
    expect(t.calls()).toBe(1);
    expect(t.waits).toEqual([]);
    expect(nextDelay(1, 30_001)).toEqual({ tooLong: true });
  });
});
