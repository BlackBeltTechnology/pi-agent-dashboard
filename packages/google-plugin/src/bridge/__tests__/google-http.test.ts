/**
 * L1 Google REST layer shared by every product (test-plan #B90–#B98, #C13–#C23; tasks 11.88–11.96,
 * 12.13–12.23): 403 classification from the machine reason only, bounded backoff with `Retry-After`,
 * write-retry rules (scenario-gate B15 / C1 / C2). See change: add-google-connect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleApi } from "../google-http.js";
import { createFakeGoogle, type FakeReply, googleError, type HostAccount, jsonOf, makeToolHost } from "./fake-google.js";
import { allProbes, PRODUCTS_7 } from "./probe-tools.js";

const ACCT: HostAccount = { sub: "s1", email: "a@x.com", alias: "work", products: Object.fromEntries(PRODUCTS_7.map((p) => [p, "write"])) as HostAccount["products"] };

/** A host whose `/ping` answers `reply`; `sleeps` records every backoff wait (the wait itself is skipped). */
function host(reply: FakeReply | FakeReply[], opts: { random?: () => number; real?: boolean; timeoutMs?: number } = {}) {
  const sleeps: number[] = [];
  const google = createFakeGoogle().on("GET", "/ping", reply);
  const h = makeToolHost({
    accounts: [ACCT],
    google,
    products: allProbes(),
    runtime: {
      random: opts.random ?? (() => 0),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      sleep: opts.real
        ? (ms) => {
            sleeps.push(ms);
            return new Promise<void>((r) => setTimeout(r, ms));
          }
        : async (ms) => {
            sleeps.push(ms);
          },
    },
  });
  return { ...h, sleeps, call: (p = "sheets") => h.run(`probe_${p}_read`, { account: "work" }) };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
afterEach(() => vi.useRealTimers());

const SERVICE_OF = {
  calendar: "calendar-json.googleapis.com",
  drive: "drive.googleapis.com",
  docs: "docs.googleapis.com",
  sheets: "sheets.googleapis.com",
  slides: "slides.googleapis.com",
  tasks: "tasks.googleapis.com",
  contacts: "people.googleapis.com",
} as const;
const disabled = (service: string, consumer?: string) => googleError(403, "SERVICE_DISABLED", { service, ...(consumer ? { consumer } : {}) }, "API has not been used in project");

describe("403 classification — machine reason only", () => {
  it("#B90 SERVICE_DISABLED names the API, the numeric project and the enable command", async () => {
    const h = host(disabled("sheets.googleapis.com", "projects/123456789"));
    const e = await err(h.call());
    expect(e?.code).toBe("api_disabled");
    expect(e?.message).toContain("sheets.googleapis.com");
    expect(e?.message).toContain("123456789");
    expect(e?.message).toContain("gcloud services enable sheets.googleapis.com --project 123456789");
    expect(h.google.calls).toHaveLength(1);
  });

  it("#B91 without consumer metadata: still api_disabled naming the API, no placeholder text", async () => {
    const e = await err(host(disabled("sheets.googleapis.com")).call());
    expect(e?.code).toBe("api_disabled");
    expect(e?.message).toContain("sheets.googleapis.com");
    expect(e?.message).not.toMatch(/undefined|projects\/|null/);
  });

  it("#B92 ACCESS_TOKEN_SCOPE_INSUFFICIENT → scope_insufficient pointing at the product level in Google accounts; never retried", async () => {
    const h = host(googleError(403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT"));
    const e = await err(h.call());
    expect(e?.code).toBe("scope_insufficient");
    expect(e?.message).toContain("Google Sheets");
    expect(e?.message).toContain('"read"');
    expect(e?.message).toContain("Settings \u2192 Google accounts");
    expect(h.google.calls).toHaveLength(1);
  });

  it("#B93 decoys: human text, other reasons, no body — never api_disabled / scope_insufficient", async () => {
    const decoys: FakeReply[] = [
      googleError(403, "forbidden", undefined, "Google Sheets API has not been used in project 1 before or it is disabled"),
      googleError(403, "rateLimitExceeded", undefined, "access not configured, insufficient permissions"),
      { status: 403 },
      { status: 403, text: "Sheets API has not been used / ACCESS_TOKEN_SCOPE_INSUFFICIENT" },
      // the disabled reason, but for ANOTHER API than the tool's product
      googleError(403, "SERVICE_DISABLED", { service: "drive.googleapis.com", consumer: "projects/1" }),
    ];
    for (const d of decoys) {
      const e = await err(host(d).call());
      expect(e?.code).toBe("sheets_error");
      expect(e?.status).toBe(403);
    }
  });

  for (const p of PRODUCTS_7) {
    it(`#B94/#C13 ${p}: disabled-API 403 names ${SERVICE_OF[p]}, project 123456789012 and its own enable command`, async () => {
      const e = await err(host(disabled(SERVICE_OF[p], "projects/123456789012")).call(p));
      expect(e?.code).toBe("api_disabled");
      expect(e?.message).toContain(`gcloud services enable ${SERVICE_OF[p]} --project 123456789012`);
      for (const other of Object.values(SERVICE_OF)) if (other !== SERVICE_OF[p]) expect(e?.message).not.toContain(other);
    });
    it(`#B94 ${p}: a generic 403 / 404 / 400 falls to ${p}_error`, async () => {
      const code = `${p}_error`;
      for (const r of [googleError(403, "forbidden"), { status: 404, json: { error: { message: "nope", status: "NOT_FOUND" } } }, { status: 400, json: { error: { message: "bad", status: "INVALID_ARGUMENT" } } }]) {
        expect((await err(host(r).call(p)))?.code).toBe(code);
      }
    });
  }

  it("#C14 legacy `errors[].reason: insufficientPermissions` → scope_insufficient, no retry", async () => {
    const h = host({ status: 403, json: { error: { code: 403, message: "x", errors: [{ reason: "insufficientPermissions", domain: "global" }] } } });
    expect((await err(h.call()))?.code).toBe("scope_insufficient");
    expect(h.google.calls).toHaveLength(1);
  });

  it("#C15 another 403 reason (file not shared) → <product>_error carrying the Google reason, not api_disabled", async () => {
    const e = await err(host(googleError(403, "forbidden", undefined, "The caller does not have permission")).call("drive"));
    expect(e?.code).toBe("drive_error");
    expect(e?.message).toContain("forbidden");
    expect(e?.message).toContain("HTTP 403");
  });

  it("#C16 non-JSON, empty and shape-less 403 bodies fall to <product>_error without throwing a parse error", async () => {
    const bodies: FakeReply[] = [
      { status: 403, text: "<html>denied</html>" },
      { status: 403, text: "" },
      { status: 403, json: {} },
      { status: 403, json: [] },
      { status: 403, json: { error: "str" } },
      { status: 403, json: { error: { details: "x", errors: 5 } } },
      { status: 403, json: { error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", metadata: { service: "sheets.googleapis.com" } }] } } },
    ];
    for (const b of bodies) {
      const e = await err(host(b).call("calendar"));
      expect(e?.name).toBe("GoogleToolError");
      expect(e?.code).toBe("calendar_error");
    }
  });

  it("hostile body text never reaches the message as an enable command / project", async () => {
    const e = await err(host(googleError(403, "SERVICE_DISABLED", { service: "evil.example.com; rm -rf /", consumer: "projects/12 ; curl x" })).call());
    expect(e?.code).toBe("sheets_error");
    expect(e?.message).not.toMatch(/rm -rf|curl/);
  });
});

describe("429 / 5xx backoff — 3 attempts, Retry-After, jitter, cap", () => {
  const r429: FakeReply = { status: 429, json: { error: { message: "slow down" } } };
  const ok: FakeReply = { json: { ok: true } };

  it("#C17 429, 429, 200 → 3 requests, the 200 body is the result; waits 500 then 1000 ms", async () => {
    const h = host([r429, r429, ok]);
    expect(jsonOf(await h.call())).toEqual({ ok: true });
    expect(h.google.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([500, 1000]);
  });

  it("#B95 N × 429 then 200: N=1,2 succeed; N=3,4 fail with the last error — never more than 3 requests", async () => {
    for (const [n, calls, success] of [[1, 2, true], [2, 3, true], [3, 3, false], [4, 3, false]] as const) {
      const h = host([...Array.from({ length: n }, () => r429), ok]);
      const e = await err(h.call());
      expect(h.google.calls, `N=${n}`).toHaveLength(calls);
      if (success) expect(e).toBeUndefined();
      else {
        expect(e?.code).toBe("rate_limited");
        expect(e?.status).toBe(429);
      }
    }
  });

  it("#C18 always 503 → exactly 3 requests (not 4), then an error carrying status 503", async () => {
    const h = host({ status: 503, json: { error: { message: "unavailable", status: "UNAVAILABLE" } } });
    const e = await err(h.call("calendar"));
    expect(h.google.calls).toHaveLength(3);
    expect(e?.status).toBe(503);
    expect(e?.code).toBe("calendar_error");
    expect(e?.message).toContain("503");
  });

  it("#B97/#C21 500, 502, 503 are retried; 400, 401, 404, 409 and 403 are not (exactly 1 request)", async () => {
    for (const status of [500, 502, 503]) {
      const h = host([{ status }, ok]);
      expect(jsonOf(await h.call())).toEqual({ ok: true });
      expect(h.google.calls).toHaveLength(2);
    }
    for (const status of [400, 401, 404, 409, 403]) {
      const h = host({ status, json: { error: { message: "m" } } });
      const e = await err(h.call());
      expect(h.google.calls, `${status}`).toHaveLength(1);
      expect(e?.status).toBe(status);
      expect(e?.code).toBe("sheets_error");
    }
  });

  it("#B96 Retry-After: 7 → waits ≥ 7 s; the HTTP-date form too; absent → 500 ms backoff with jitter", async () => {
    let h = host([{ ...r429, headers: { "retry-after": "7" } }, ok]);
    await h.call();
    expect(h.sleeps).toEqual([7000]);

    h = host([{ ...r429, headers: { "retry-after": new Date(Date.now() + 8500).toUTCString() } }, ok]);
    await h.call();
    expect(h.sleeps[0]).toBeGreaterThanOrEqual(7000);
    expect(h.sleeps[0]).toBeLessThanOrEqual(8500);

    for (const [random, first, second] of [[0, 500, 1000], [1, 625, 1250]] as const) {
      h = host([r429, r429, ok], { random: () => random });
      await h.call();
      expect(h.sleeps).toEqual([first, second]);
    }
  });

  it("#C19 Retry-After: 2 — the 2nd request is not sent before 2 000 ms (fake timers)", async () => {
    vi.useFakeTimers();
    const h = host([{ ...r429, headers: { "retry-after": "2" } }, ok], { real: true });
    const p = h.call();
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.google.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(jsonOf(await p)).toEqual({ ok: true });
    expect(h.google.calls).toHaveLength(2);
    expect((h.google.calls[1]?.at ?? 0) - (h.google.calls[0]?.at ?? 0)).toBe(2000);
  });

  it("#C20 Retry-After 0 / -1 / abc / a past date → the default backoff (finite, > 0); a future date is honoured", async () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    for (const v of ["0", "-1", "abc", "1e9", "", past]) {
      const h = host([{ ...r429, headers: { "retry-after": v } }, ok]);
      await h.call();
      expect(h.sleeps, v).toEqual([500]);
    }
    const h = host([{ ...r429, headers: { "retry-after": new Date(Date.now() + 5500).toUTCString() } }, ok]);
    await h.call();
    expect(h.sleeps[0]).toBeGreaterThan(4000);
    expect(h.sleeps[0]).toBeLessThanOrEqual(5500);
  });

  it("#B98/#C20 Retry-After beyond 30 s (3600, 86400) fails at once with rate_limited — 1 request, no wait; 30 s itself is honoured", async () => {
    for (const v of ["3600", "86400", "31"]) {
      const h = host([{ ...r429, headers: { "retry-after": v } }, ok]);
      const e = await err(h.call());
      expect(e?.code, v).toBe("rate_limited");
      expect(h.google.calls).toHaveLength(1);
      expect(h.sleeps).toEqual([]);
    }
    const h = host([{ ...r429, headers: { "retry-after": "30" } }, ok]);
    await h.call();
    expect(h.sleeps).toEqual([30_000]);
  });

  it("a 503 with an excessive Retry-After also fails at once (the cap applies to 5xx)", async () => {
    const h = host([{ status: 503, headers: { "retry-after": "999" } }, ok]);
    expect((await err(h.call()))?.code).toBe("rate_limited");
    expect(h.google.calls).toHaveLength(1);
  });

  it("#C23 connection reset ×3 → 3 requests then a bounded error; no unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const h = host({ fail: "network" });
      const e = await err(h.call("docs"));
      expect(e?.code).toBe("docs_error");
      expect(e?.message).toContain("could not reach");
      expect(h.google.calls).toHaveLength(3);
      // a response that never ends is cut by the per-attempt timeout, then retried within the same bound
      const hang = host({ fail: "hang" }, { timeoutMs: 30 });
      expect((await err(hang.call("docs")))?.code).toBe("docs_error");
      expect(hang.google.calls).toHaveLength(3);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a cancelled tool call stops at once (no retry) with `aborted`", async () => {
    const google = createFakeGoogle().on("GET", "/ping", { fail: "hang" });
    const ac = new AbortController();
    const api = new GoogleApi({ product: "docs", base: "http://x/docs/v1", token: "T", fetchImpl: google.fetchImpl, sleep: async () => undefined, signal: ac.signal });
    const p = err(api.request("GET", "/ping"));
    setTimeout(() => ac.abort(), 10);
    expect((await p)?.code).toBe("aborted");
    expect(google.calls).toHaveLength(1);
  });

  it("the bearer token never appears in an error message", async () => {
    const h = host({ status: 500, text: "ACCESS-s1 leaked" });
    const e = await err(h.call());
    expect(e?.message).not.toContain("ACCESS-s1");
  });
});

describe("#C22 write retry rule (scenario-gate C2): 429 always; 5xx only for GET / PUT / DELETE", () => {
  const api = (google: ReturnType<typeof createFakeGoogle>, sleeps: number[] = []) =>
    new GoogleApi({ product: "calendar", base: "http://x/calendar/v3", token: "T", fetchImpl: google.fetchImpl, sleep: async (ms) => void sleeps.push(ms), random: () => 0 });

  for (const [method, retried] of [["GET", true], ["PUT", true], ["DELETE", true], ["POST", false], ["PATCH", false]] as const) {
    it(`${method}: 503 then 200 → ${retried ? "2 requests, success" : "1 request, error 503 (no duplicate write)"}`, async () => {
      const google = createFakeGoogle().on(method, "/e", [{ status: 503, json: { error: { message: "x" } } }, { json: { id: "1" } }]);
      const r = await err(api(google).request(method, "/e", method === "GET" ? {} : { body: { a: 1 } }));
      expect(google.calls).toHaveLength(retried ? 2 : 1);
      if (retried) expect(r).toBeUndefined();
      else expect(r?.status).toBe(503);
    });
    it(`${method}: 429 then 200 is retried`, async () => {
      const google = createFakeGoogle().on(method, "/e", [{ status: 429 }, { json: { id: "1" } }]);
      expect(await err(api(google).request(method, "/e", method === "GET" ? {} : { body: { a: 1 } }))).toBeUndefined();
      expect(google.calls).toHaveLength(2);
    });
    it(`${method}: a dropped connection is ${retried ? "retried" : "not replayed"}`, async () => {
      const google = createFakeGoogle().on(method, "/e", [{ fail: "network" }, { json: { id: "1" } }]);
      await err(api(google).request(method, "/e", method === "GET" ? {} : { body: { a: 1 } }));
      expect(google.calls).toHaveLength(retried ? 2 : 1);
    });
  }

  it("an empty 200/204 reply is `{}`, text and bytes can be requested, query lists repeat", async () => {
    const google = createFakeGoogle().on("DELETE", "/e", { status: 204 }).on("GET", "/t", { text: "plain" }).on("GET", "/b", { text: "AB" });
    const a = api(google);
    expect(await a.request("DELETE", "/e")).toEqual({});
    expect(await a.request("GET", "/t", { as: "text" })).toBe("plain");
    expect((await a.request<Buffer>("GET", "/b", { as: "bytes", query: { f: ["x", "y"], n: 2, skip: undefined } })).toString()).toBe("AB");
    expect(google.calls[2]?.queryAll).toEqual({ f: ["x", "y"], n: ["2"] });
    expect(google.calls[0]?.headers.authorization).toBe("Bearer T");
  });
});
