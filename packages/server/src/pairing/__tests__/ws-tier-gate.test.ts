/**
 * See change: add-passkey-user-auth (WS half of the session tier gate).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideWsTier, sweepRevokedSockets, WS_CLOSE_SESSION_REVOKED, type SweepableSocket } from "../ws-tier-gate.js";

describe("decideWsTier", () => {
  it("leaves sockets without a session tier ungated", () => {
    expect(decideWsTier({}, "force_kill")).toEqual({ kind: "allow" });
  });
  it("observe socket: reads pass, prompts and kills are dropped", () => {
    const s = { sessionTier: () => "observe" as const };
    expect(decideWsTier(s, "subscribe").kind).toBe("allow");
    expect(decideWsTier(s, "send_prompt")).toEqual({ kind: "drop", required: "control", principalTier: "observe" });
    expect(decideWsTier(s, "force_kill").kind).toBe("drop");
  });
  it("control socket: prompts pass, terminals/kill dropped, unknown types fail closed", () => {
    const s = { sessionTier: () => "control" as const };
    expect(decideWsTier(s, "send_prompt").kind).toBe("allow");
    expect(decideWsTier(s, "create_terminal").kind).toBe("drop");
    expect(decideWsTier(s, "plugin_custom_thing").kind).toBe("drop");
  });
  it("operate socket passes everything", () => {
    expect(decideWsTier({ sessionTier: () => "operate" }, "force_kill").kind).toBe("allow");
  });
  it("a revoked session closes the socket", () => {
    expect(decideWsTier({ sessionTier: () => null }, "subscribe")).toEqual({ kind: "close" });
  });
  it("re-reads the tier per message (re-tier applies immediately)", () => {
    let tier: "observe" | "control" = "observe";
    const s = { sessionTier: () => tier };
    expect(decideWsTier(s, "send_prompt").kind).toBe("drop");
    tier = "control";
    expect(decideWsTier(s, "send_prompt").kind).toBe("allow");
  });
});

// ─── Reload sweep (close-security-map-high-findings D3, OA5) ─────────────────

/** Fake `ws` socket: `close(code)` flips readyState to CLOSING and queues the close event. */
function fakeSocket(sessionTier?: () => "operate" | null, readyState = 1) {
  const closeEvents: number[] = [];
  const sock = {
    readyState,
    sessionTier,
    close: vi.fn((code?: number) => {
      sock.readyState = 2;
      closeEvents.push(code ?? 1005);
    }),
    closeEvents,
  };
  return sock as typeof sock & SweepableSocket;
}

describe("sweepRevokedSockets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("#E101 closes revoked browser + terminal sockets with 4401; passkey/device/local/other-provider sockets stay open", () => {
    let githubRevoked = true;
    const ghBrowser = fakeSocket(() => (githubRevoked ? null : "operate"));
    const ghTerminal = fakeSocket(() => (githubRevoked ? null : "operate"));
    const passkey = fakeSocket(() => "operate");
    const deviceTicket = fakeSocket(); // no sessionTier
    const local = fakeSocket();
    const keycloak = fakeSocket(() => "operate");
    const log = vi.fn();
    const result = sweepRevokedSockets(
      { browser: { clients: new Set([ghBrowser, passkey, deviceTicket, keycloak]) }, terminal: { clients: new Set([ghTerminal, local]) } },
      log,
    );
    expect(result).toEqual({ total: 2, byGateway: { browser: 1, terminal: 1 } });
    expect(ghBrowser.close).toHaveBeenCalledWith(WS_CLOSE_SESSION_REVOKED, expect.any(String));
    expect(ghTerminal.close).toHaveBeenCalledWith(4401, expect.any(String));
    for (const s of [passkey, deviceTicket, local, keycloak]) expect(s.close).not.toHaveBeenCalled();
    // synchronous: CLOSING and the 4401 close event are there when the call returns, no inbound frame
    expect(ghBrowser.readyState).toBe(2);
    expect(ghBrowser.closeEvents).toEqual([4401]);
    expect(ghTerminal.closeEvents).toEqual([4401]);
    // exactly one aggregate line: counts only, no identity
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/closed 2 .*browser=1.*terminal=1/);
    expect(log.mock.calls[0][0]).not.toMatch(/github|keycloak|@/);
  });

  it("#E104 a sweep with N=0 logs nothing", () => {
    const log = vi.fn();
    const result = sweepRevokedSockets({ browser: { clients: [fakeSocket(() => "operate"), fakeSocket()] } }, log);
    expect(result.total).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("#E114 many sockets: every stamped-revoked socket is closed on return, each visited once, one aggregate line", () => {
    const sockets = Array.from({ length: 5000 }, (_, i) => fakeSocket(i % 2 === 0 ? () => null : undefined));
    const visits = new Map<object, number>();
    const spied = sockets.map((s) => {
      if (s.sessionTier) {
        const orig = s.sessionTier;
        s.sessionTier = () => {
          visits.set(s, (visits.get(s) ?? 0) + 1);
          return orig();
        };
      }
      return s;
    });
    const log = vi.fn();
    const result = sweepRevokedSockets({ browser: { clients: spied.slice(0, 2500) }, terminal: { clients: spied.slice(2500) } }, log);
    expect(result.total).toBe(2500);
    for (const s of spied) {
      if (s.sessionTier) {
        expect(s.close).toHaveBeenCalledTimes(1);
        expect(visits.get(s)).toBe(1);
      } else {
        expect(s.close).not.toHaveBeenCalled();
      }
    }
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("#X17 reload races: CLOSING/CLOSED sockets are skipped (no double close); two sweeps count only sockets actually closed", () => {
    const closing = fakeSocket(() => null, 2);
    const closed = fakeSocket(() => null, 3);
    const live = fakeSocket(() => null);
    const allowed = fakeSocket(() => "operate");
    const log = vi.fn();
    const gateways = { browser: { clients: [closing, closed, live, allowed] } };
    const first = sweepRevokedSockets(gateways, log);
    const second = sweepRevokedSockets(gateways, log);
    expect(first.total).toBe(1);
    expect(second.total).toBe(0); // `live` is now CLOSING
    expect(closing.close).not.toHaveBeenCalled();
    expect(closed.close).not.toHaveBeenCalled();
    expect(live.close).toHaveBeenCalledTimes(1);
    expect(allowed.close).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a throwing sessionTier/close on one socket is logged at error level and does not stop the sweep", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = fakeSocket(() => {
      throw new Error("boom");
    });
    const good = fakeSocket(() => null);
    const result = sweepRevokedSockets({ browser: { clients: [bad, good] } }, vi.fn());
    expect(result.total).toBe(1);
    expect(good.close).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });
});

describe("sweep wired to the auth reload (real plugin)", () => {
  it("#E101/#E104 reload that refuses github closes its sockets; also when the last provider is removed (G8) and groupTiers lifts it", async () => {
    const { default: Fastify } = await import("fastify");
    const { effectiveSessionTier, registerAuthPlugin } = await import("../../auth/auth-plugin.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const SECRET = "test-secret-32-chars-long-abcdef";
    const gh = { clientId: "c", clientSecret: "s" };
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const clients = new Set<SweepableSocket>();
    const log = vi.fn();
    const app = Fastify();
    // allowedUsers set at boot → github sessions are live; the reload removes it
    const handle = await registerAuthPlugin(app, {
      authConfig: { secret: SECRET, providers: { github: gh }, allowedUsers: ["a@x"] } as any,
      port: 8000,
      onAuthReloaded: () => {
        sweepRevokedSockets({ browser: { clients } }, log);
      },
    });
    await app.ready();
    const mk = (provider: string) => {
      const s = fakeSocket(() => effectiveSessionTier({ provider, sub: "a", name: "a", username: "a", exp: 9e9 } as any, undefined, handle.isSessionProviderRejected) as "operate" | null);
      sockets.push(s);
      clients.add(s);
      return s;
    };
    const gh1 = mk("github");
    const local = fakeSocket();
    clients.add(local);

    await (app as any)._reloadAuth({ secret: SECRET, providers: { github: gh }, allowedUsers: ["b@x"] });
    expect(gh1.close).not.toHaveBeenCalled(); // still allowed → stays
    await (app as any)._reloadAuth({ secret: SECRET, providers: { github: gh }, allowedUsers: [] });
    expect(gh1.close).toHaveBeenCalledWith(4401, expect.any(String)); // refused → closed by the time reload resolves
    expect(local.close).not.toHaveBeenCalled();

    const gh2 = mk("github");
    await (app as any)._reloadAuth({ secret: SECRET, providers: { github: gh }, groupTiers: { ops: "operate" } });
    expect(gh2.close).not.toHaveBeenCalled(); // groupTiers lifts the refusal

    const gh3 = mk("github");
    await (app as any)._reloadAuth({ secret: SECRET, providers: {} }); // last provider removed → auth inactive
    expect(gh3.close).toHaveBeenCalledWith(4401, expect.any(String)); // G8: sweep still runs
    expect(local.close).not.toHaveBeenCalled();
    await app.close();
  });
});
