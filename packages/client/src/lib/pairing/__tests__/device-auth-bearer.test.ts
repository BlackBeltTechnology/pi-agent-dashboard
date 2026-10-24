import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clearAccessToken, setAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../api/api-context.js";
import {
  clearDeviceBearer,
  finishDevicePairing,
  getApiBearer,
  installDeviceAuthFetch,
  migrateLegacyDeviceBearer,
  onDeviceBearerNotice,
  resetDeviceAuthRuntimeForTests,
  startDeviceBearerRotation,
  storeDeviceBearer,
} from "../device-auth.js";

/** Capture the Authorization header the wrapper produced for a given URL. */
function authHeaderFor(spy: ReturnType<typeof vi.fn>): string | null {
  const init = spy.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  const headers = new Headers(init?.headers);
  return headers.get("Authorization");
}

describe("getApiBearer precedence (§12.2)", () => {
  beforeEach(() => {
    clearAccessToken();
    clearDeviceBearer();
  });

  it("prefers the in-memory identity token over the device bearer", () => {
    storeDeviceBearer("device-tok");
    setAccessToken("identity-tok", 300);
    expect(getApiBearer()).toBe("identity-tok");
  });

  it("falls back to the device bearer when no identity token", () => {
    storeDeviceBearer("device-tok");
    expect(getApiBearer()).toBe("device-tok");
  });

  it("is null when neither credential is present (cookie/loopback path)", () => {
    expect(getApiBearer()).toBeNull();
  });
});

describe("installDeviceAuthFetch wrapper (§12.2)", () => {
  let original: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearAccessToken();
    clearDeviceBearer();
    original = vi.fn(async () => new Response(null, { status: 200 }));
    // Reset the idempotency guard so each test re-wraps our fresh spy.
    (window as unknown as { __piDeviceAuthFetch?: boolean }).__piDeviceAuthFetch = false;
    window.fetch = original as unknown as typeof fetch;
    installDeviceAuthFetch();
  });

  afterEach(() => {
    window.fetch = original as unknown as typeof fetch;
  });

  it("attaches the identity bearer to same-origin /api", async () => {
    setAccessToken("identity-tok", 300);
    await window.fetch("/api/sessions");
    expect(authHeaderFor(original)).toBe("Bearer identity-tok");
  });

  it("never overrides an explicit Authorization header", async () => {
    setAccessToken("identity-tok", 300);
    await window.fetch("/api/sessions", { headers: { Authorization: "Bearer explicit" } });
    expect(authHeaderFor(original)).toBe("Bearer explicit");
  });

  it("does not attach to a cross-origin request", async () => {
    setAccessToken("identity-tok", 300);
    await window.fetch("https://evil.example/api/steal");
    expect(authHeaderFor(original)).toBeNull();
  });

  it("does not attach to a non-/api same-origin request", async () => {
    setAccessToken("identity-tok", 300);
    await window.fetch("/index.html");
    expect(authHeaderFor(original)).toBeNull();
  });

  it("attaches nothing when no credential is held (inert)", async () => {
    await window.fetch("/api/sessions");
    expect(authHeaderFor(original)).toBeNull();
  });
});

// ── harden-auth-credentials (D5): per-origin slots, rotation, expiry ──────────

const LEGACY = "pi-dashboard:device-bearer";
const SLOT = (origin: string) => `${LEGACY}:${origin}`;
const A = "https://a.example";
const B = "https://b.example";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ROTATE = "/api/paired-devices/rotate";
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

const putSlot = (origin: string, token: string, expiresAt?: number) =>
  localStorage.setItem(SLOT(origin), JSON.stringify(expiresAt === undefined ? { token } : { token, expiresAt }));
const rawSlot = (origin: string) => localStorage.getItem(SLOT(origin));
const authOf = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers).get("Authorization");
const urlOf = (call: unknown[]) => String(call[0]);

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Install the wrapper over a routing spy; returns the spy and helpers over its calls. */
function installOver(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  (window as unknown as { __piDeviceAuthFetch?: boolean }).__piDeviceAuthFetch = false;
  window.fetch = spy as unknown as typeof fetch;
  installDeviceAuthFetch();
  const rotates = () => spy.mock.calls.filter((c) => urlOf(c).endsWith(ROTATE));
  return { spy, rotates };
}

/** Stub `window.location` so `assign` is observable; origin stays the jsdom page origin. */
function stubNavigation() {
  const assign = vi.fn();
  const real = window.location;
  vi.stubGlobal("location", { ...Object.fromEntries(["origin", "href", "protocol", "host", "hostname", "port", "pathname", "search", "hash"].map((k) => [k, (real as unknown as Record<string, string>)[k]])), assign });
  return assign;
}

/** Let fire-and-forget rotation/401 handlers settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("harden-auth-credentials: per-origin bearer slots + rotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    resetDeviceAuthRuntimeForTests();
    clearAccessToken();
    localStorage.clear();
    setGlobalApiBase("");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    setGlobalApiBase("");
  });

  it("AE55 a slot is exact-origin: no prefix / near-match / other-port leakage", async () => {
    putSlot(A, "TA");
    putSlot("https://a.example.evil.test", "TE");
    const { spy } = installOver(() => json(200));
    await window.fetch("https://a.example/api/sessions");
    await window.fetch("https://a.example.evil.test/api/sessions");
    await window.fetch("https://a.example:8443/api/sessions");
    expect(spy.mock.calls.map(authOf)).toEqual(["Bearer TA", "Bearer TE", null]);
  });

  it("AE57 legacy key is deleted while an existing per-origin slot is untouched and used", async () => {
    localStorage.setItem(LEGACY, "old-tok");
    putSlot(B, "new-tok");
    setGlobalApiBase(B);
    const { spy } = installOver(() => json(200));
    await migrateLegacyDeviceBearer();
    await window.fetch("/api/sessions");
    await window.fetch(`${B}/api/sessions`);
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(JSON.parse(rawSlot(B) ?? "null")).toEqual({ token: "new-tok" });
    expect(spy.mock.calls.map(authOf)).toEqual([null, "Bearer new-tok"]);
  });

  describe("rotation threshold (25 % of issue→expiresAt)", () => {
    /** Startup rotation at T gives the client a known issue time and expiry (`lifetime` ms). */
    async function startedAt(lifetime: number, handlerAfter: Handler = () => json(200)) {
      const T = Date.now();
      putSlot(B, "S0", T + lifetime);
      setGlobalApiBase(B);
      let n = 0;
      const env = installOver((url, init) =>
        url.endsWith(ROTATE)
          ? json(200, { token: `R${++n}`, expiresAt: Date.now() + lifetime })
          : handlerAfter(url, init),
      );
      await startDeviceBearerRotation();
      await settle();
      expect(JSON.parse(rawSlot(B) ?? "null")).toEqual({ token: "R1", expiresAt: T + lifetime });
      env.spy.mockClear();
      return env;
    }

    it("AE59 rotates once, only after < 25 % (42 h of 7 d) remains", async () => {
      const { spy, rotates } = await startedAt(7 * DAY);
      await vi.advanceTimersByTimeAsync(125 * HOUR + 59 * 60_000);
      await window.fetch(`${B}/api/sessions`);
      await settle();
      expect(rotates()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await window.fetch(`${B}/api/sessions`);
      await settle();
      expect(rotates()).toHaveLength(1);
      const [, init] = rotates()[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({ holder: "browser" });
      expect(authOf(rotates()[0])).toBe("Bearer R1");
      expect(JSON.parse(rawSlot(B) ?? "null").token).toBe("R2");
      expect(spy).toBeDefined();
    });

    it("AE74 threshold uses the CURRENT bearer's own lifetime (ceiling-capped 5 d → 90 h, not 126 h)", async () => {
      const { rotates } = await startedAt(5 * DAY);
      await vi.advanceTimersByTimeAsync(89 * HOUR + 59 * 60_000);
      await window.fetch(`${B}/api/sessions`);
      await settle();
      expect(rotates()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      await window.fetch(`${B}/api/sessions`);
      await settle();
      expect(rotates()).toHaveLength(1);
    });

    it("AP3 no rotation storm: 100 calls over 10 minutes after a rotation send 0 further rotates", async () => {
      const { spy, rotates } = await startedAt(7 * DAY);
      for (let i = 0; i < 100; i++) {
        await window.fetch(`${B}/api/sessions`);
        await vi.advanceTimersByTimeAsync(6_000);
      }
      await settle();
      expect(rotates()).toHaveLength(0); // total since startup = the 1 cleared by mockClear
      expect(spy.mock.calls).toHaveLength(100);
    });
  });

  it("AE60 startup rotates once even with > 25 % left, presenting the slot bearer", async () => {
    putSlot(B, "S0", Date.now() + 6 * DAY + 23 * HOUR);
    const { rotates } = installOver(() => json(200, { token: "S1", expiresAt: Date.now() + 7 * DAY }));
    await startDeviceBearerRotation(B); // base derived from the saved server before React sets it
    await settle();
    expect(rotates()).toHaveLength(1);
    expect(authOf(rotates()[0])).toBe("Bearer S0");
    expect(JSON.parse(rawSlot(B) ?? "null").token).toBe("S1");
  });

  it("AE61 bearer_expired: one fetch to A (no retry), slot A removed, slot B kept, re-pair started for A", async () => {
    putSlot(A, "TA", Date.now() + 7 * DAY);
    putSlot(B, "TB", Date.now() + 7 * DAY);
    const assign = stubNavigation();
    const { spy } = installOver((url) => (url.startsWith(A) ? json(401, { code: "bearer_expired" }) : json(200)));
    const res = await window.fetch(`${A}/api/sessions`);
    await settle();
    expect(res.status).toBe(401);
    expect(spy.mock.calls.filter((c) => urlOf(c).startsWith(A))).toHaveLength(1);
    expect(rawSlot(A)).toBeNull();
    expect(JSON.parse(rawSlot(B) ?? "null").token).toBe("TB");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0][0])).toBe(`${A}/pair?request`);
  });

  it("AE62 a tab picks up another tab's rotated bearer on the storage event and does not rotate", async () => {
    setGlobalApiBase(B);
    putSlot(B, "T1", Date.now() + 7 * DAY);
    const { spy, rotates } = installOver(() => json(200));
    await window.fetch(`${B}/api/sessions`);
    putSlot(B, "T2", Date.now() + 7 * DAY); // tab A writes
    window.dispatchEvent(new StorageEvent("storage", { key: SLOT(B), newValue: rawSlot(B) }));
    await window.fetch(`${B}/api/sessions`);
    await settle();
    expect(spy.mock.calls.map(authOf)).toEqual(["Bearer T1", "Bearer T2"]);
    expect(rotates()).toHaveLength(0);
  });

  it("AE76 pairing stores {token, expiresAt} from the poll response; no rotate call to learn the expiry", async () => {
    setGlobalApiBase(B);
    const exp = Date.now() + 7 * DAY;
    const { spy, rotates } = installOver(() => json(200));
    expect(await finishDevicePairing("T1", exp)).toEqual({ keepFailed: false });
    expect(JSON.parse(rawSlot(B) ?? "null")).toEqual({ token: "T1", expiresAt: exp });
    await window.fetch(`${B}/api/sessions`);
    await settle();
    expect(rotates()).toHaveLength(0);
    expect(spy.mock.calls).toHaveLength(1);
    expect(authOf(spy.mock.calls[0])).toBe("Bearer T1");
  });

  it("AE77 five concurrent bearer_expired answers: slot removed once, ONE navigation, nothing retried", async () => {
    putSlot(A, "TA", Date.now() + 7 * DAY);
    const assign = stubNavigation();
    const { spy } = installOver(() => json(401, { code: "bearer_expired" }));
    await Promise.all(Array.from({ length: 5 }, () => window.fetch(`${A}/api/sessions`)));
    await settle();
    expect(spy).toHaveBeenCalledTimes(5);
    expect(rawSlot(A)).toBeNull();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("AE78 the Electron/CLI keyring path never reaches the browser slot, holder declaration or rotation", () => {
    // Structural (A-G19): keyring modules never import the browser slot module nor name its key / declaration.
    const root = resolve(__dirname, "../../../../../"); // packages/
    const files = [
      "electron/src/lib/pairing-client.ts",
      "electron/src/lib/pairing-code-client.ts",
      "electron/src/lib/server-keyring.ts",
      "electron/src/lib/server-windows-main.ts",
      "shell/src/lib/connect.ts",
      "shell/src/lib/keyring.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, rel).not.toMatch(/pairing\/device-auth/);
      expect(src, rel).not.toContain("pi-dashboard:device-bearer");
      expect(src, rel).not.toMatch(/holder\s*:\s*["']browser["']/);
      expect(src, rel).not.toContain("paired-devices/rotate");
    }
  });

  describe("failure semantics", () => {
    /** A slot already past its 25 % threshold (1 h of a 7 d lifetime left), page on B. */
    function dueSlot() {
      setGlobalApiBase(B);
      putSlot(B, "T1", Date.now() + HOUR);
    }

    it("AX5 a lost rotation answer keeps B0; the retry's 409 bearer_superseded never overwrites it", async () => {
      dueSlot();
      let n = 0;
      const { spy, rotates } = installOver((url) => {
        if (!url.endsWith(ROTATE)) return json(200);
        if (++n === 1) throw new TypeError("network error");
        return json(409, { code: "bearer_superseded" });
      });
      const before = rawSlot(B);
      await window.fetch(`${B}/api/sessions`);
      await settle();
      expect(rotates()).toHaveLength(1);
      expect(rawSlot(B)).toBe(before);
      await vi.advanceTimersByTimeAsync(61_000); // retry is call-driven, ≥ 60 s later
      await window.fetch(`${B}/api/sessions`);
      await settle();
      expect(rotates()).toHaveLength(2);
      expect(rawSlot(B)).toBe(before);
      expect(spy.mock.calls.filter((c) => !urlOf(c).endsWith(ROTATE)).map(authOf)).toEqual(["Bearer T1", "Bearer T1"]);
    });

    it.each([
      ["{}", () => json(200, {})],
      ['{"token":""}', () => json(200, { token: "" })],
      ['{"token":"x"} (no expiresAt)', () => json(200, { token: "x" })],
      ["non-JSON ok", () => new Response("ok", { status: 200 })],
    ])("AX6 malformed rotate answer %s never corrupts the slot", async (_name, answer) => {
      dueSlot();
      const before = rawSlot(B);
      const { spy } = installOver((url) => (url.endsWith(ROTATE) ? (answer as () => Response)() : json(200)));
      await startDeviceBearerRotation();
      await settle();
      expect(rawSlot(B)).toBe(before);
      await window.fetch(`${B}/api/sessions`);
      expect(authOf(spy.mock.calls.at(-1) as unknown[])).toBe("Bearer T1");
    });

    it("AX7 409 bearer_superseded does not wipe the slot: no re-pair, the other tab's T2 wins", async () => {
      dueSlot();
      const assign = stubNavigation();
      const removeItem = vi.spyOn(Storage.prototype, "removeItem");
      const { spy } = installOver((url) => {
        if (!url.endsWith(ROTATE)) return json(200);
        putSlot(B, "T2", Date.now() + 7 * DAY); // tab A won the race
        return json(409, { code: "bearer_superseded" });
      });
      await startDeviceBearerRotation();
      await settle();
      window.dispatchEvent(new StorageEvent("storage", { key: SLOT(B), newValue: rawSlot(B) }));
      await window.fetch(`${B}/api/sessions`);
      expect(removeItem.mock.calls.filter((c) => String(c[0]).startsWith(LEGACY))).toEqual([]);
      expect(assign).not.toHaveBeenCalled();
      expect(authOf(spy.mock.calls.at(-1) as unknown[])).toBe("Bearer T2");
    });

    it("AX8 an old server's 404 keeps T1, no re-pair, and rotate is not re-sent on every call", async () => {
      dueSlot();
      const assign = stubNavigation();
      const { spy, rotates } = installOver((url) => (url.endsWith(ROTATE) ? json(404) : json(200)));
      await startDeviceBearerRotation();
      await settle();
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(61_000);
        await window.fetch(`${B}/api/sessions`);
      }
      await settle();
      expect(rotates()).toHaveLength(1);
      expect(JSON.parse(rawSlot(B) ?? "null").token).toBe("T1");
      expect(spy.mock.calls.filter((c) => !urlOf(c).endsWith(ROTATE)).map(authOf)).toEqual(Array(3).fill("Bearer T1"));
      expect(assign).not.toHaveBeenCalled();
    });

    it("AX14 a failed rotation is retried on the next call, at most once a minute, with no timer", async () => {
      dueSlot();
      const notices = vi.fn();
      onDeviceBearerNotice(notices);
      const answers: Array<() => Response> = [
        () => {
          throw new TypeError("network error");
        },
        () => json(503),
        () => json(200, { token: "T2", expiresAt: Date.now() + 7 * DAY }),
      ];
      const stamps: number[] = [];
      const t0 = Date.now();
      const { rotates } = installOver((url) => {
        if (!url.endsWith(ROTATE)) return json(200);
        stamps.push(Math.round((Date.now() - t0) / 1000));
        return (answers.shift() as () => Response)();
      });
      let tokenBefore200 = "";
      let prev = 0;
      for (const at of [0, 30, 61, 90, 122]) {
        await vi.advanceTimersByTimeAsync((at - prev) * 1000);
        prev = at;
        if (at === 122) tokenBefore200 = JSON.parse(rawSlot(B) ?? "null").token;
        await window.fetch(`${B}/api/sessions`);
        await settle();
      }
      expect(stamps).toEqual([0, 61, 122]);
      expect(rotates()).toHaveLength(3);
      expect(tokenBefore200).toBe("T1"); // old bearer kept until the 200
      expect(JSON.parse(rawSlot(B) ?? "null").token).toBe("T2");
      expect(vi.getTimerCount()).toBe(0);
      expect(notices).not.toHaveBeenCalled();
    });

    it("AX15 setItem quota failure: the new bearer is kept in memory, ONE warning, no re-pair, no 401", async () => {
      dueSlot();
      const assign = stubNavigation();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const real = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
        if (k.startsWith(LEGACY)) throw new DOMException("quota", "QuotaExceededError");
        return real.call(this, k, v);
      });
      const notices = vi.fn();
      onDeviceBearerNotice(notices);
      const { spy } = installOver((url) =>
        url.endsWith(ROTATE) ? json(200, { token: "T2", expiresAt: Date.now() + 7 * DAY }) : json(200),
      );
      await startDeviceBearerRotation();
      await settle();
      await window.fetch(`${B}/api/sessions`);
      await window.fetch(`${B}/api/sessions`);
      expect(spy.mock.calls.filter((c) => !urlOf(c).endsWith(ROTATE)).map(authOf)).toEqual(["Bearer T2", "Bearer T2"]);
      expect(notices).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
