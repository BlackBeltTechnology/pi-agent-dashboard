import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccessToken, setAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";
import { clearDeviceBearer, getApiBearer, installDeviceAuthFetch, storeDeviceBearer } from "../device-auth.js";

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
