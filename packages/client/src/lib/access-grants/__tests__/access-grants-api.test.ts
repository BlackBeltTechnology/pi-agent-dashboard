/**
 * Transport tests for the Access-tab revoke routing (change:
 * add-access-grants-and-review, tasks 7.5 / 7.8 / 7.12).
 *
 * Each store's revoke must hit ITS OWN write path (7.5). Project trust must
 * route through the existing `persistTrustDecision` wrapper route with
 * `decision: null` — a DELETE, never a standing refusal (7.12, design D13).
 * The 7.8 scenario runs against an in-memory server simulation: revoke mutates
 * the live grant state the gate consults, and the next request is refused
 * again — no restart involved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAccessSnapshot, revokeAccessEntry } from "../access-grants-api.js";
import { type AccessGrantSnapshot, emptyAccessGrantSnapshot } from "../access-grants-types.js";
import { aggregateAccessEntries } from "../aggregate-access-entries.js";

type RecordedCall = { method: string; url: string; body: Record<string, unknown> };
type FetchArgs = { method?: string; body?: string };

/** Minimal router over in-memory grant state, standing in for the server. */
function makeServer(state: { grants: AccessGrantSnapshot }) {
  const calls: RecordedCall[] = [];
  const respond = (method: string, url: string, body: Record<string, unknown>) => {
    calls.push({ method, url, body });
    const json = (data: unknown, ok = true) =>
      Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve({ success: ok, data }) });

    if (method === "GET" && url === "/api/access/grants") return json(state.grants);
    if (method === "DELETE" && url === "/api/access/grants") {
      state.grants.pathGrants = state.grants.pathGrants.filter(
        (g) => !(g.subject === body.subject && g.scope === body.scope),
      );
      return json(state.grants);
    }
    if (method === "DELETE" && url === "/api/access/worktree-trust") {
      state.grants.worktreeTrust = state.grants.worktreeTrust.filter((s) => s !== body.subject);
      return json(state.grants);
    }
    if (method === "DELETE" && url === "/api/kb/source-trust") {
      state.grants.kbTrust = state.grants.kbTrust.filter((k) => k.hash !== body.hash);
      return json(state.grants);
    }
    // Server-side this route wraps `persistTrustDecision`, which writes
    // `decision: null`; pi's `setMany` DELETES the key on null (verified in
    // pi's `core/trust-manager.js`). The client therefore sends `{ subject }`
    // and never a decision — it cannot record a standing refusal by accident.
    if (method === "DELETE" && url === "/api/access/project-trust") {
      if (typeof body.subject === "string" && body.decision === undefined) {
        state.grants.projectTrust = state.grants.projectTrust.filter((p) => p !== body.subject);
        return json(state.grants);
      }
      // A decision field means the client is trying to supply the trust-store
      // update itself — out of contract (the wrapper owns that).
      return json({ error: "unsupported" }, false);
    }
    if (method === "DELETE" && url === "/api/access/bypass-hosts") {
      state.grants.bypassHosts = state.grants.bypassHosts.filter((h) => h !== body.host);
      return json(state.grants);
    }
    if (method === "DELETE" && url === "/api/access/trusted-network") {
      // Per-entry: the SERVER reads-modifies-writes, so the client does not send
      // the remaining list and sibling entries survive (task 4.5 #5).
      state.grants.trustedNetworks = state.grants.trustedNetworks.filter(
        (n) => n !== body.network,
      );
      return json(state.grants);
    }
    if (method === "DELETE" && url === "/api/access/cors-origin") {
      state.grants.corsOrigins = state.grants.corsOrigins.filter((o) => o !== body.origin);
      return json(state.grants);
    }
    // Kept because the endpoint is real and `/api/config` is still how these
    // fields are written wholesale. Nothing in the client uses it any more; it
    // is here so a run against the PRE-FIX client fails on genuine resurrection
    // rather than a 404, which is what makes the concurrency test below a real
    // regression guard.
    if (method === "PUT" && url === "/api/config") {
      if (Array.isArray(body.trustedNetworks)) state.grants.trustedNetworks = body.trustedNetworks as string[];
      if (body.cors && typeof body.cors === "object") {
        state.grants.corsOrigins = (body.cors as { allowedOrigins?: string[] }).allowedOrigins ?? [];
      }
      return json(state.grants);
    }
    if (method === "DELETE" && url === "/api/access/pinned-directory") {
      // Unpins ONE directory by subject (the preferences-store write path).
      state.grants.pinnedDirectories = state.grants.pinnedDirectories.filter(
        (d) => d !== body.subject,
      );
      return json(state.grants);
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ success: false }) });
  };
  return {
    calls,
    state,
    install() {
      global.fetch = vi.fn().mockImplementation(
        (url: string, options?: FetchArgs) =>
          respond(options?.method ?? "GET", url, options?.body ? JSON.parse(options.body) : {}),
      ) as unknown as typeof fetch;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function seededState(): { grants: AccessGrantSnapshot } {
  return {
    grants: {
      ...emptyAccessGrantSnapshot(),
      pathGrants: [
        { subject: "/repo/sub", scope: "project", grantedAt: "2026-01-01T00:00:00Z", origin: "sess-a" },
        { subject: "/repo/tmp", scope: "session", grantedAt: "2026-01-02T00:00:00Z", origin: "sess-b" },
      ],
      worktreeTrust: ["/repo\u0000abc123"],
      kbTrust: [{ hash: "c0ffee00" }],
      projectTrust: ["/home/dev/project"],
      trustedNetworks: ["192.168.1.0/24", "10.0.0.0/8"],
      bypassHosts: ["nas.local"],
      corsOrigins: ["https://a.example.com", "https://b.example.com"],
      pinnedDirectories: ["/home/dev/pinned", "/home/dev/other"],
    },
  };
}

describe("4.5 #5 — concurrent revokes cannot resurrect each other", () => {
  it("two revokes issued before either refetch BOTH stick (array-valued stores)", async () => {
    // `trustedNetworks`/`corsOrigins` are ARRAY-valued config fields. While the
    // client computed the remaining list from a rendered snapshot, two revokes
    // fired before the first refetch both derived from the SAME array, and the
    // later write resurrected the entry the earlier one had just removed. This
    // is the race the fix closes: per-entry deletes compose, stale arrays do not.
    const state = seededState();
    const server = makeServer(state);
    server.install();

    const a = await entryFor("trustedNetworks", "192.168.1.0/24", state);
    const b = await entryFor("trustedNetworks", "10.0.0.0/8", state);
    // Fire both WITHOUT awaiting the first — the exact interleaving that failed.
    await Promise.all([revokeAccessEntry(a.entry), revokeAccessEntry(b.entry)]);
    expect(state.grants.trustedNetworks).toEqual([]);

    const c = await entryFor("corsOrigins", "https://a.example.com", state);
    const d = await entryFor("corsOrigins", "https://b.example.com", state);
    await Promise.all([revokeAccessEntry(c.entry), revokeAccessEntry(d.entry)]);
    expect(state.grants.corsOrigins).toEqual([]);
  });
});

async function entryFor(store: string, subject: string, state: { grants: AccessGrantSnapshot }) {
  const { ok, snapshot } = await fetchAccessSnapshot();
  expect(ok).toBe(true);
  const entry = aggregateAccessEntries(snapshot!).find((e) => e.store === store && e.subject === subject);
  expect(entry, `no ${store} entry for ${subject}`).toBeDefined();
  return { entry: entry!, snapshot: snapshot! };
}

describe("revoke routes each store to its own write path (7.5)", () => {
  const cases: Array<{ store: string; subject: string; assert: (call: RecordedCall) => void }> = [
    {
      store: "pathGrants",
      subject: "/repo/sub",
      assert: (c) => {
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/access/grants");
        expect(c.body).toEqual({ subject: "/repo/sub", scope: "project" });
      },
    },
    {
      store: "worktreeTrust",
      subject: "/repo\u0000abc123",
      assert: (c) => {
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/access/worktree-trust");
        expect(c.body).toEqual({ subject: "/repo\u0000abc123" });
      },
    },
    {
      store: "kbTrust",
      subject: "c0ffee00",
      assert: (c) => {
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/kb/source-trust");
        expect(c.body).toEqual({ hash: "c0ffee00" });
      },
    },
    {
      store: "trustedNetworks",
      subject: "10.0.0.0/8",
      assert: (c) => {
        // Per-entry DELETE. Previously a whole-array PUT whose remaining list the
        // client computed from a rendered snapshot — two concurrent revokes then
        // resurrected each other's entry.
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/access/trusted-network");
        expect(c.body).toEqual({ network: "10.0.0.0/8" });
      },
    },
    {
      store: "bypassHosts",
      subject: "nas.local",
      assert: (c) => {
        // auth.bypassHosts — its own store, never trustedNetworks.
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/access/bypass-hosts");
        expect(c.body).toEqual({ host: "nas.local" });
      },
    },
    {
      store: "corsOrigins",
      subject: "https://b.example.com",
      assert: (c) => {
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/access/cors-origin");
        expect(c.body).toEqual({ origin: "https://b.example.com" });
      },
    },
    {
      store: "pinnedDirectories",
      subject: "/home/dev/other",
      assert: (c) => {
        // The preferences-store write path, addressing one directory by
        // subject — sibling entries are untouched because the server unpins a
        // single folder, it does not rewrite the whole list.
        expect(c.method).toBe("DELETE");
        expect(c.url).toBe("/api/access/pinned-directory");
        expect(c.body).toEqual({ subject: "/home/dev/other" });
      },
    },
  ];

  for (const tc of cases) {
    it(`${tc.store}: revokes against its own write path`, async () => {
      const state = seededState();
      const server = makeServer(state);
      server.install();
      const { entry, snapshot } = await entryFor(tc.store, tc.subject, state);
      const result = await revokeAccessEntry(entry);
      expect(result.ok).toBe(true);
      expect(server.calls).toHaveLength(2); // GET snapshot + the revoke
      tc.assert(server.calls[1]);
    });
  }
});

describe("project-trust revoke wraps persistTrustDecision server-side (7.12, D13)", () => {
  it("DELETEs /api/access/project-trust with the subject and never a decision", async () => {
    const state = seededState();
    const server = makeServer(state);
    server.install();
    const { entry, snapshot } = await entryFor("projectTrust", "/home/dev/project", state);
    await revokeAccessEntry(entry);

    const call = server.calls[1];
    expect(call.method).toBe("DELETE");
    // NOT `/api/resources/trust`: that route is gated on an outstanding trust
    // challenge and takes an option id, so it cannot express a revoke.
    expect(call.url).toBe("/api/access/project-trust");
    expect(call.body.subject).toBe("/home/dev/project");
    // The client never supplies a decision — the server-side wrapper owns the
    // `decision: null` delete. Sending `false` would RECORD a standing refusal.
    expect(call.body.decision).toBeUndefined();
    expect(call.body.decision).not.toBe(false);
  });

  it("removes the entry — no standing refusal remains in the store", async () => {
    const state = seededState();
    const server = makeServer(state);
    server.install();
    const { entry, snapshot } = await entryFor("projectTrust", "/home/dev/project", state);
    await revokeAccessEntry(entry);

    const after = await fetchAccessSnapshot();
    expect(after.snapshot!.projectTrust).not.toContain("/home/dev/project");
  });
});

describe("revocation takes effect on the next request without a restart (7.8)", () => {
  /**
   * In-memory stand-in for the grant-gated file plane: a request succeeds only
   * while a matching grant exists in the LIVE state the revoke mutates. The
   * real 403 enforcement is the server side of this change; this pins the
   * client-visible contract — one revoke call, next request refused, no
   * restart anywhere.
   */
  function makeGatedServer() {
    const state = seededState();
    const server = makeServer(state);
    let gateRequests = 0;
    const installBase = server.install.bind(server);
    server.install = () => {
      installBase();
      const baseFetch = global.fetch as unknown as (url: string, options?: FetchArgs) => Promise<{
        ok: boolean;
        status: number;
        json: () => Promise<unknown>;
      }>;
      global.fetch = vi.fn().mockImplementation((url: string, options?: FetchArgs) => {
        if ((options?.method ?? "GET") === "GET" && url === "/api/file/raw?path=/repo/sub/notes.txt") {
          gateRequests++;
          const allowed = state.grants.pathGrants.some(
            (g) => g.subject === "/repo/sub" && g.scope === "project",
          );
          return Promise.resolve({
            ok: allowed,
            status: allowed ? 200 : 403,
            json: () =>
              Promise.resolve(
                allowed ? { success: true } : { success: false, error: "path outside working directory" },
              ),
          });
        }
        return baseFetch(url, options);
      }) as unknown as typeof fetch;
    };
    return { server, state, gateRequests: () => gateRequests };
  }

  it("grant → revoke → retry is refused again, in-process", async () => {
    const harness = makeGatedServer();
    harness.server.install();

    const gateUrl = "/api/file/raw?path=/repo/sub/notes.txt";
    const gate = async () => {
      const res = await (global.fetch as (u: string) => Promise<{ status: number }>)(gateUrl);
      return res.status;
    };

    // Grant in effect: the request the grant admits succeeds.
    expect(await gate()).toBe(200);

    // Revoke through the Access-tab transport.
    const { entry, snapshot } = await entryFor("pathGrants", "/repo/sub", harness.state);
    const result = await revokeAccessEntry(entry);
    expect(result.ok).toBe(true);

    // NEXT request — same process, no restart — is refused again.
    expect(await gate()).toBe(403);
    expect(harness.gateRequests()).toBe(2);

    // And the tab's next read no longer lists the entry.
    const after = await fetchAccessSnapshot();
    expect(
      aggregateAccessEntries(after.snapshot!).some(
        (e) => e.store === "pathGrants" && e.subject === "/repo/sub",
      ),
    ).toBe(false);
  });
});
