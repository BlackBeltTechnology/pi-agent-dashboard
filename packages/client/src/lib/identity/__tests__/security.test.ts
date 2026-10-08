/**
 * Security abuse cases for the client login seam (login page, handoff, sign-out).
 * Each test is an attacker move; the assertion is that it gains nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { buildSignInUrl, completeHandoff, loginPathFor, PROVIDER_KEY, readLoginReturn, signOutTarget, VERIFIER_KEY } from "../dashboard-login.js";
import { safeReturnTo } from "../gate.js";
import { bootLoginSession, getLoginSession, resetLoginSessionForTests } from "../login-session.js";

const ORIGIN = "http://127.0.0.1:8020";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

// ── Open redirect: returnTo can never leave the dashboard origin ─────────────
const HOSTILE_RETURN_TO = [
  "https://evil.example/",
  "//evil.example/x",
  "/\\evil.example",
  "\\\\evil.example",
  "/\t/evil.example",
  "/\n/evil.example",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "https:evil.example",
  "http://127.0.0.1:8020@evil.example/",
  "http://127.0.0.1:80200/",
  "/callback",
  "/auth/login",
];

describe("open redirect via returnTo", () => {
  it.each(HOSTILE_RETURN_TO)("safeReturnTo(%j) stays on the dashboard origin", (raw) => {
    const out = safeReturnTo(raw, ORIGIN);
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
    expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
  });

  it.each(HOSTILE_RETURN_TO)("the sign-in URL never carries a hostile returnTo (%j)", (raw) => {
    const url = new URL(buildSignInUrl("/idl/start", raw, "C", ORIGIN) ?? "", ORIGIN);
    const rt = url.searchParams.get("returnTo") ?? "";
    expect(new URL(rt, ORIGIN).origin).toBe(ORIGIN);
  });

  it("loginPathFor always yields a same-origin /login path (target is only ever a query value)", () => {
    for (const raw of HOSTILE_RETURN_TO) {
      const p = loginPathFor(raw);
      expect(p.startsWith("/login")).toBe(true);
      expect(new URL(p, ORIGIN).origin).toBe(ORIGIN);
    }
  });

  it("an off-origin loginUrl is never navigated to", () => {
    for (const loginUrl of ["https://evil.example/start", "//evil.example/start", "javascript:alert(1)"]) {
      expect(buildSignInUrl(loginUrl, "/", "C", ORIGIN)).toBeNull();
    }
  });
});

// ── Token exchange: the code + verifier never leave the origin ───────────────
describe("handoff exchange", () => {
  it.each(["https://evil.example/token", "//evil.example/token", "/\\evil.example/token", "javascript:alert(1)"])(
    "refuses an off-origin tokenUrl (%j) — code + verifier are never sent there",
    async (tokenUrl) => {
      const fetchFn = vi.fn();
      const res = await completeHandoff({ code: "abc", tokenUrl, storage: memoryStorage({ [VERIFIER_KEY]: "V" }), fetchFn, setToken: vi.fn() });
      expect(res.ok).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("a code without this browser's verifier is useless (login CSRF: attacker's code injected into a victim)", async () => {
    const fetchFn = vi.fn();
    const setToken = vi.fn();
    const res = await completeHandoff({ code: "attacker-code", tokenUrl: "/idl/token", storage: memoryStorage(), fetchFn, setToken });
    expect(res).toEqual({ ok: false, reason: "missing_verifier" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(setToken).not.toHaveBeenCalled();
  });

  it("the verifier is single-use: consumed even when the exchange fails", async () => {
    const storage = memoryStorage({ [VERIFIER_KEY]: "V" });
    await completeHandoff({ code: "c", tokenUrl: "/idl/token", storage, fetchFn: vi.fn(async () => new Response("{}", { status: 400 })), setToken: vi.fn() });
    expect(storage.getItem(VERIFIER_KEY)).toBeNull();
  });

  it("a malformed token response (no string access_token) signs nobody in", async () => {
    for (const body of [{}, { access_token: 42 }, { access_token: "" }, { access_token: ["x"] }]) {
      const setToken = vi.fn();
      const res = await completeHandoff({
        code: "c",
        tokenUrl: "/idl/token",
        storage: memoryStorage({ [VERIFIER_KEY]: "V" }),
        fetchFn: vi.fn(async () => new Response(JSON.stringify(body))),
        setToken,
      });
      expect(res.ok, JSON.stringify(body)).toBe(false);
      expect(setToken).not.toHaveBeenCalled();
    }
  });

  it("a tampered provider id in sessionStorage cannot redirect the exchange (only listed providers' tokenUrls are used)", async () => {
    resetLoginSessionForTests();
    const kc = { pluginId: "idl", loginUrl: "/idl/start", tokenUrl: "/idl/token" };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ access_token: "AT", expires_in: 60 })));
    let token = false;
    await bootLoginSession({
      location: { pathname: "/", search: "", hash: "#pi_handoff=abc" } as Location,
      history: { state: null, replaceState: vi.fn() } as unknown as History,
      storage: memoryStorage({ [VERIFIER_KEY]: "V", [PROVIDER_KEY]: "https://evil.example/token" }),
      persist: memoryStorage(),
      fetchFn,
      fetchConfig: async () => ({ active: true, ...kc, providers: [kc] }),
      setToken: () => {
        token = true;
      },
      hasToken: () => token,
      navigate: vi.fn(),
    });
    expect(String((fetchFn.mock.calls[0] as unknown[])[0])).toBe("/idl/token");
    expect(getLoginSession().providerId).toBe("idl");
  });
});

// ── Fragment / query injection ───────────────────────────────────────────────
describe("injection via the login return and sign-out", () => {
  it("a hostile #pi_login_error is kept as an opaque string (never parsed as markup/URL)", () => {
    const r = readLoginReturn("#pi_login_error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    expect(r).toEqual({ kind: "error", reason: "<img src=x onerror=alert(1)>" });
  });

  it("an id_token cannot inject extra sign-out parameters (returnTo stays /login)", () => {
    const target = signOutTarget({ logoutUrl: "/idl/signout" }, ORIGIN, "a.b.c&returnTo=https://evil.example&x=");
    const u = new URL(target, ORIGIN);
    expect(u.origin).toBe(ORIGIN);
    expect(u.searchParams.getAll("returnTo")).toEqual(["/login"]);
    expect(u.searchParams.get("id_token_hint")).toBe("a.b.c&returnTo=https://evil.example&x=");
  });

  it("an off-origin logoutUrl is never followed on sign-out", () => {
    for (const logoutUrl of ["https://evil.example/out", "//evil.example/out"]) {
      expect(signOutTarget({ logoutUrl }, ORIGIN, "a.b.c")).toBe("/login?pi_signed_out=1");
    }
  });

  it("only the exact prompt value `none` is ever added to the sign-in URL", () => {
    const silent = new URL(buildSignInUrl("/idl/start", "/", "C", ORIGIN, true) ?? "", ORIGIN);
    expect(silent.searchParams.getAll("prompt")).toEqual(["none"]);
    const normal = new URL(buildSignInUrl("/idl/start", "/", "C", ORIGIN) ?? "", ORIGIN);
    expect(normal.searchParams.has("prompt")).toBe(false);
  });
});
