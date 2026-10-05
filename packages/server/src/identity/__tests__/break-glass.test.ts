import { describe, expect, it } from "vitest";
import { BreakGlass, BREAK_GLASS_BEARER_PREFIX, BREAK_GLASS_BEARER_TTL_MS, BREAK_GLASS_CODE_TTL_MS } from "../break-glass.js";
import { isLocalOperator, LOCAL_OPERATOR } from "../session-access.js";

const T0 = 1_000_000;
const bg = () => new BreakGlass();

describe("BreakGlass one-time code (D23)", () => {
  it("issues a code that redeems exactly once for an operator bearer", () => {
    const b = bg();
    const { code, expiresInSeconds } = b.issueCode(T0);
    expect(code.length).toBeGreaterThanOrEqual(32);
    expect(expiresInSeconds).toBe(BREAK_GLASS_CODE_TTL_MS / 1000);
    const first = b.redeem(code, T0 + 1000);
    expect(first).not.toBeNull();
    expect(first!.accessToken.startsWith(BREAK_GLASS_BEARER_PREFIX)).toBe(true);
    expect(b.redeem(code, T0 + 1001)).toBeNull(); // single-use
  });

  it("a code is dead after its ≤60 s window", () => {
    const b = bg();
    const { code } = b.issueCode(T0);
    expect(BREAK_GLASS_CODE_TTL_MS).toBeLessThanOrEqual(60_000);
    expect(b.redeem(code, T0 + BREAK_GLASS_CODE_TTL_MS + 1)).toBeNull();
  });

  it("an unknown, empty or non-string code never redeems; a failed redeem does not burn a valid code", () => {
    const b = bg();
    const { code } = b.issueCode(T0);
    for (const bad of ["", "nope", `${code}x`, undefined, null, 42, {}]) expect(b.redeem(bad as never, T0)).toBeNull();
    expect(b.redeem(code, T0)).not.toBeNull();
  });

  it("a code is bound to this instance: another instance cannot redeem it", () => {
    const a = bg();
    const { code } = a.issueCode(T0);
    expect(bg().redeem(code, T0)).toBeNull();
  });

  it("caps outstanding codes so issuing cannot grow without bound", () => {
    const b = bg();
    const first = b.issueCode(T0).code;
    for (let i = 0; i < 100; i++) b.issueCode(T0);
    expect(b.redeem(first, T0)).toBeNull(); // oldest evicted
  });
});

describe("BreakGlass operator bearer", () => {
  it("resolves to the local operator principal with a short expiry", () => {
    const b = bg();
    const token = b.redeem(b.issueCode(T0).code, T0)!.accessToken;
    const res = b.resolveBearer(`Bearer ${token}`, T0 + 5);
    expect(res).not.toBeNull();
    expect(isLocalOperator(res!.principal)).toBe(true); // same reference, not a copy
    expect(res!.principal.name).toMatch(/break-glass/i);
    expect(res!.expiresAt).toBe(T0 + BREAK_GLASS_BEARER_TTL_MS);
    expect(Object.isFrozen(res!.principal)).toBe(true);
  });

  it("expires, and is rejected for anything that is not exactly a live operator bearer", () => {
    const b = bg();
    const token = b.redeem(b.issueCode(T0).code, T0)!.accessToken;
    expect(b.resolveBearer(`Bearer ${token}`, T0 + BREAK_GLASS_BEARER_TTL_MS + 1)).toBeNull();
    for (const h of [undefined, "", "Bearer ", `Basic ${token}`, `Bearer ${token}x`, "Bearer other", token]) {
      expect(b.resolveBearer(h, T0 + 5)).toBeNull();
    }
  });

  it("is only recognised on its own prefix, so a foreign JWT is never consulted here", () => {
    const b = bg();
    expect(b.resolveBearer("Bearer eyJhbGciOi.x.y", T0)).toBeNull();
  });
});

describe("LOCAL_OPERATOR identity", () => {
  it("is matched by reference only: a look-alike copy is an ordinary principal", () => {
    expect(isLocalOperator(LOCAL_OPERATOR)).toBe(true);
    expect(isLocalOperator({ ...LOCAL_OPERATOR })).toBe(false);
    expect(isLocalOperator({ iss: "https://idp", sub: "local-operator" })).toBe(false);
    expect(isLocalOperator(null)).toBe(false);
  });
});
