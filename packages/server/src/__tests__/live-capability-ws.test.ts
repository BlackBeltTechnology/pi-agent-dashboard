/**
 * Live-preview capability × WebSocket upgrade authorization.
 *
 * E24: identity floor × capability minter on `/live/vite-5173/~c/<t>/ws`.
 * E27: a capability token never opens a core socket (`/ws`, `/ws/terminal/*`,
 *      `/ws/bridge`), whatever path/query it rides in.
 *
 * `upgrade()` mirrors the `server.ts` upgrade handler: the scope comes from
 * `routeScopeForUrl`, and the capability is parsed + validated ONLY for scope
 * `live`, then handed to `authorizeWsUpgrade`.
 *
 * See change: retire-trusted-networks-bypass (D5; test-plan E24, E27).
 */
import { describe, expect, it } from "vitest";
import { authorizeWsUpgrade } from "../auth/auth-plugin.js";
import type { CoreWsRouteScope } from "../auth/ws-ticket.js";
import { routeScopeForUrl } from "../auth/ws-ticket.js";
import {
  type CapabilityPrincipal,
  LiveCapabilityStore,
  parseCapabilityPath,
} from "../live-server/live-capability.js";

const REMOTE = "203.0.113.5"; // not loopback, not trusted
const PRINCIPAL = { iss: "https://idp.example", sub: "user-1" } as const;
const IDENTITY_EXP = 1_900_000_000_000;

const devicePrincipal: CapabilityPrincipal = { kind: "device", tier: "control", deviceId: "dev-A" };
const identityPrincipal: CapabilityPrincipal = {
  kind: "session",
  tier: "control",
  identity: PRINCIPAL,
  identityExpiresAt: IDENTITY_EXP,
};

function upgrade(
  store: LiveCapabilityStore,
  url: string,
  opts: { requireIdentityTicket?: boolean } = {},
) {
  const scope = routeScopeForUrl(url) as CoreWsRouteScope | null;
  const cap = scope === "live" ? parseCapabilityPath(url) : null;
  const principal = cap ? store.validate(cap.targetId, cap.token) : null;
  return authorizeWsUpgrade({
    remoteAddress: REMOTE,
    secret: "s3cret",
    trustedNetworks: [],
    scope,
    headers: {},
    requireIdentityTicket: opts.requireIdentityTicket ?? false,
    liveCapability: principal ? { identity: principal.identity, identityExpiresAt: principal.identityExpiresAt } : null,
  });
}

describe("E24 — identity floor × capability (live scope)", () => {
  it("floor enforced + device-minted capability (no identity) → refused", () => {
    const store = new LiveCapabilityStore();
    const { token } = store.mint("vite-5173", devicePrincipal);
    expect(upgrade(store, `/live/vite-5173/~c/${token}/ws`, { requireIdentityTicket: true }).ok).toBe(false);
  });

  it("floor enforced + identity-minted capability → ok, bound to the principal and its expiry", () => {
    const store = new LiveCapabilityStore();
    const { token } = store.mint("vite-5173", identityPrincipal);
    const r = upgrade(store, `/live/vite-5173/~c/${token}/ws`, { requireIdentityTicket: true });
    expect(r.ok).toBe(true);
    expect(r.principal).toEqual(PRINCIPAL);
    expect(r.principalExpiresAt).toBe(IDENTITY_EXP);
  });

  it("floor off + device-minted capability → ok", () => {
    const store = new LiveCapabilityStore();
    const { token } = store.mint("vite-5173", devicePrincipal);
    expect(upgrade(store, `/live/vite-5173/~c/${token}/ws`).ok).toBe(true);
  });

  it("floor off + identity-minted capability → ok with the principal", () => {
    const store = new LiveCapabilityStore();
    const { token } = store.mint("vite-5173", identityPrincipal);
    const r = upgrade(store, `/live/vite-5173/~c/${token}/ws`);
    expect(r).toMatchObject({ ok: true, principal: PRINCIPAL, principalExpiresAt: IDENTITY_EXP });
  });

  it("a capability minted for another target, an unknown token, or no capability never admits", () => {
    const store = new LiveCapabilityStore();
    const { token } = store.mint("docs-8080", identityPrincipal);
    expect(upgrade(store, `/live/vite-5173/~c/${token}/ws`).ok).toBe(false);
    expect(upgrade(store, `/live/vite-5173/~c/${"A".repeat(43)}/ws`).ok).toBe(false);
    expect(upgrade(store, "/live/vite-5173/ws").ok).toBe(false);
  });

  it("a revoked / expired token is refused on the upgrade as on HTTP", () => {
    let now = 1_000_000;
    const store = new LiveCapabilityStore({ now: () => now });
    const { token } = store.mint("vite-5173", devicePrincipal);
    store.revokeByDevice("dev-A");
    expect(upgrade(store, `/live/vite-5173/~c/${token}/ws`).ok).toBe(false);
    const { token: t2 } = store.mint("vite-5173", devicePrincipal);
    now += 30 * 60_000;
    expect(upgrade(store, `/live/vite-5173/~c/${t2}/ws`).ok).toBe(false);
  });

  it("the token is read from the path segment only — never the query", () => {
    const store = new LiveCapabilityStore();
    const { token } = store.mint("vite-5173", devicePrincipal);
    expect(upgrade(store, `/live/vite-5173/ws?c=${token}`).ok).toBe(false);
    expect(upgrade(store, `/live/vite-5173/ws?ticket=${token}`).ok).toBe(false);
  });
});

describe("E27 — capability never opens a core socket", () => {
  const store = new LiveCapabilityStore();
  const { token } = store.mint("vite-5173", identityPrincipal);
  const validLive = { identity: PRINCIPAL, identityExpiresAt: IDENTITY_EXP };

  const coreUrls: Array<[string, CoreWsRouteScope]> = [
    ["/ws", "browser"],
    ["/ws?c=" + token, "browser"],
    ["/ws?ticket=" + token, "browser"],
    ["/ws/terminal/x", "terminal"],
    [`/ws/terminal/x?c=${token}`, "terminal"],
    [`/ws/terminal/~c/${token}/x`, "terminal"],
    ["/ws/bridge", "bridge"],
    [`/ws/bridge?c=${token}`, "bridge"],
  ];

  it.each(coreUrls)("%s resolves to its core scope, never `live`", (url, scope) => {
    expect(routeScopeForUrl(url)).toBe(scope);
  });

  it("URLs that merely embed a capability path under /ws never resolve to `live`", () => {
    for (const url of [
      `/ws/live/vite-5173/~c/${token}/`,
      `/ws/bridge/live/vite-5173/~c/${token}/`,
      `/ws?next=/live/vite-5173/~c/${token}/`,
    ]) {
      expect(routeScopeForUrl(url)).not.toBe("live");
    }
  });

  it.each(coreUrls)("authorizeWsUpgrade(%s) with a valid capability handed in → refused", (url, scope) => {
    // Even a caller that wrongly passed a validated capability for a core scope
    // is refused: the capability is honoured for scope `live` only.
    for (const requireIdentityTicket of [false, true]) {
      const r = authorizeWsUpgrade({
        remoteAddress: REMOTE,
        secret: "s3cret",
        trustedNetworks: [],
        scope,
        headers: {},
        requireIdentityTicket,
        liveCapability: validLive,
      });
      expect(r.ok, `${url} floor=${requireIdentityTicket}`).toBe(false);
    }
  });

  it.each(coreUrls)("the server-shaped path (%s) refuses with the token in path/query", (url) => {
    expect(upgrade(store, url).ok).toBe(false);
    expect(upgrade(store, url, { requireIdentityTicket: true }).ok).toBe(false);
  });

  it("control: the same token does admit its own live path", () => {
    expect(upgrade(store, `/live/vite-5173/~c/${token}/ws`).ok).toBe(true);
  });
});
