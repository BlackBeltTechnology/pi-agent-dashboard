/**
 * L1 token-lease tests (test-plan E12, E13, E14, E16, E17, E29, P1, X1–X4).
 * See change: add-gmail-plugin.
 */
import { describe, expect, it } from "vitest";
import { CLIENT, capturingLogger, fakeGoogleFetch, memoryCredentials, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { type Op, SCOPE, TIER_SCOPES, type Tier } from "../../shared/scopes.js";
import { AccountStore, acctKey, CLIENT_KEY } from "../accounts.js";
import { createLeaseHandler } from "../lease.js";

const NOW = 1_000_000_000_000;

function setup(opts: {
  tier?: Tier;
  scopes?: string[];
  expiresIn?: number;
  status?: string;
  refresh?: Parameters<typeof fakeGoogleFetch>[0]["refresh"];
}) {
  const tier = opts.tier ?? "send";
  const creds = memoryCredentials({
    [CLIENT_KEY]: { ...CLIENT },
    [acctKey("s1")]: {
      sub: "s1",
      email: "a@x.com",
      alias: "work",
      tier,
      scopes: opts.scopes ?? [...TIER_SCOPES[tier]],
      refresh: "REFRESH-old",
      access: "ACCESS-old",
      expires: NOW + (opts.expiresIn ?? 3_600_000),
      status: opts.status ?? "ok",
      addedAt: 1,
    },
  });
  const google = fakeGoogleFetch({
    refresh: opts.refresh ?? (() => ({ access_token: "ACCESS-new", expires_in: 3600, token_type: "Bearer" })),
  });
  const logger = capturingLogger();
  const store = new AccountStore(creds);
  const lease = createLeaseHandler({ store, endpoints: TEST_ENDPOINTS, logger, fetchImpl: google.fetchImpl, now: () => NOW });
  return { creds, google, logger, store, lease };
}

const OPS: Op[] = ["read", "draft", "send", "modify", "trash"];
const RANK = { readonly: 0, draft: 1, send: 2 } as const;
const OP_RANK: Record<Op, number> = { read: 0, draft: 1, send: 2, modify: 2, trash: 2 };

describe("E12 — tier × op matrix", () => {
  for (const tier of ["readonly", "draft", "send"] as Tier[]) {
    for (const op of OPS) {
      const allowed = RANK[tier] >= OP_RANK[op];
      it(`${tier} × ${op} → ${allowed ? "allowed" : "tier_denied"}`, async () => {
        const { lease } = setup({ tier });
        const r = lease({ account: "work", op });
        if (allowed) await expect(r).resolves.toMatchObject({ tier });
        else await expect(r).rejects.toMatchObject({ code: "tier_denied" });
      });
    }
  }
});

describe("E13 — scope implication", () => {
  it("send tier with [gmail.modify] may lease read and draft", async () => {
    const { lease } = setup({ tier: "send", scopes: [SCOPE.modify] });
    await expect(lease({ account: "work", op: "read" })).resolves.toBeDefined();
    await expect(lease({ account: "work", op: "draft" })).resolves.toBeDefined();
  });
  it("readonly tier with [gmail.readonly], op draft → tier_denied", async () => {
    const { lease } = setup({ tier: "readonly", scopes: [SCOPE.readonly] });
    await expect(lease({ account: "work", op: "draft" })).rejects.toMatchObject({ code: "tier_denied" });
  });
});

describe("E14 — scope missing", () => {
  it("draft tier but only gmail.readonly granted → scope_missing", async () => {
    const { lease } = setup({ tier: "draft", scopes: [SCOPE.readonly] });
    await expect(lease({ account: "work", op: "draft" })).rejects.toMatchObject({ code: "scope_missing" });
  });
});

describe("E16 — lease reply shape", () => {
  it("has exactly accessToken, expiresAt, email, tier", async () => {
    const { lease } = setup({});
    const r = await lease({ account: "a@x.com", op: "read" });
    expect(Object.keys(r).sort()).toEqual(["accessToken", "email", "expiresAt", "tier"]);
    expect(JSON.stringify(r)).not.toContain("REFRESH");
  });
});

describe("E17 — refresh window", () => {
  it.each([
    [61_000, false],
    [60_000, true],
    [59_000, true],
  ])("expires in %i ms → refresh=%s", async (expiresIn, refreshes) => {
    const { lease, google } = setup({ expiresIn });
    const r = await lease({ account: "work", op: "read" });
    expect(google.calls.length).toBe(refreshes ? 1 : 0);
    expect(r.accessToken).toBe(refreshes ? "ACCESS-new" : "ACCESS-old");
  });
});

describe("P1 — single-flight refresh", () => {
  it("10 concurrent leases on an expiring account → exactly 1 refresh, same token", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { lease, google, creds } = setup({
      expiresIn: 1_000,
      refresh: async () => {
        await gate;
        return { access_token: "ACCESS-new", expires_in: 3600, token_type: "Bearer" };
      },
    });
    const all = Promise.all(Array.from({ length: 10 }, () => lease({ account: "work", op: "read" })));
    await new Promise((r) => setTimeout(r, 10));
    release();
    const replies = await all;
    expect(google.calls.filter((c) => c.grant === "refresh_token")).toHaveLength(1);
    expect(new Set(replies.map((r) => r.accessToken))).toEqual(new Set(["ACCESS-new"]));
    expect(creds.data.get(acctKey("s1"))?.access).toBe("ACCESS-new");
  });
});

describe("X1 — invalid_grant", () => {
  it("marks reauth_required, replies reauth_required, later leases refuse without network", async () => {
    const { lease, google, creds } = setup({
      expiresIn: 0,
      refresh: () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }),
    });
    await expect(lease({ account: "work", op: "read" })).rejects.toMatchObject({ code: "reauth_required" });
    expect(creds.data.get(acctKey("s1"))?.status).toBe("reauth_required");
    await expect(lease({ account: "work", op: "read" })).rejects.toMatchObject({ code: "reauth_required" });
    expect(google.calls).toHaveLength(1);
  });
});

describe("X2 — token endpoint down", () => {
  it("503 → refresh_failed, status stays ok, no token in the error", async () => {
    const { lease, creds } = setup({ expiresIn: 0, refresh: () => ({ status: 503, body: { error: "backend_error" } }) });
    const err = (await lease({ account: "work", op: "read" }).catch((e: unknown) => e)) as Error;
    expect(err).toMatchObject({ code: "refresh_failed" });
    expect(err.message).not.toMatch(/REFRESH-old|ACCESS-old|SECRET/);
    expect(creds.data.get(acctKey("s1"))?.status).toBe("ok");
  });
});

describe("X3 — slow token endpoint", () => {
  it("a caller that gave up still gets the refresh stored; the next lease reuses it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { lease, google } = setup({
      expiresIn: 0,
      refresh: async () => {
        await gate;
        return { access_token: "ACCESS-slow", expires_in: 3600, token_type: "Bearer" };
      },
    });
    const first = lease({ account: "work", op: "read" });
    // The lane caller times out (15 s in production) — model it as abandonment.
    const LANE_TIMEOUT = Symbol("timeout");
    const raced = await Promise.race([first, new Promise((r) => setTimeout(() => r(LANE_TIMEOUT), 20))]);
    expect(raced).toBe(LANE_TIMEOUT);
    release();
    await first;
    const next = await lease({ account: "work", op: "read" });
    expect(next.accessToken).toBe("ACCESS-slow");
    expect(google.calls).toHaveLength(1);
  });
});

describe("X4 — concurrent refresh + re-auth", () => {
  it("the re-auth refresh token wins; nothing clobbered", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { lease, store, creds } = setup({
      expiresIn: 0,
      refresh: async () => {
        await gate;
        return { access_token: "ACCESS-refreshed", refresh_token: "REFRESH-rotated", expires_in: 3600, token_type: "Bearer" };
      },
    });
    const inflight = lease({ account: "work", op: "read" });
    await new Promise((r) => setTimeout(r, 5));
    await store.upsertFromSignIn({
      sub: "s1",
      email: "a@x.com",
      tier: "send",
      scopes: [SCOPE.modify],
      access: "ACCESS-reauth",
      refresh: "REFRESH-reauth",
      expires: NOW + 3_600_000,
    });
    release();
    await inflight;
    const rec = creds.data.get(acctKey("s1"));
    expect(rec?.refresh).toBe("REFRESH-reauth");
    expect(rec?.alias).toBe("work");
  });
});

describe("E29 — secrets never logged", () => {
  it("lease + refresh + failures log email/op/outcome only", async () => {
    const { lease, logger } = setup({ expiresIn: 0 });
    await lease({ account: "work", op: "read" });
    await lease({ account: "work", op: "send" });
    const bad = setup({ expiresIn: 0, refresh: () => ({ status: 400, body: { error: "invalid_grant" } }) });
    await bad.lease({ account: "work", op: "read" }).catch(() => {});
    const log = [...logger.lines, ...bad.logger.lines].join("\n");
    expect(log).toContain("a@x.com");
    expect(log).not.toMatch(/ACCESS-|REFRESH-|SECRET-client/);
  });
});

describe("review round 1 — races across the refresh await", () => {
  it("a downgrade landing during the refresh is enforced before the token is returned", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { lease, store } = setup({
      expiresIn: 0,
      refresh: async () => {
        await gate;
        return { access_token: "ACCESS-new", expires_in: 3600, token_type: "Bearer" };
      },
    });
    const p = lease({ account: "work", op: "send" });
    await new Promise((r) => setTimeout(r, 5));
    await store.setTier("s1", "readonly");
    release();
    await expect(p).rejects.toMatchObject({ code: "tier_denied" });
  });

  it("a re-auth landing during a refresh: the lease returns the NEW grant's token, not the old one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { lease, store, google } = setup({
      expiresIn: 0,
      refresh: async () => {
        await gate;
        return { access_token: "ACCESS-from-old-grant", expires_in: 3600, token_type: "Bearer" };
      },
    });
    const p = lease({ account: "work", op: "read" });
    await new Promise((r) => setTimeout(r, 5));
    await store.upsertFromSignIn({
      sub: "s1",
      email: "a@x.com",
      tier: "send",
      scopes: [SCOPE.modify],
      access: "ACCESS-reauth",
      refresh: "REFRESH-reauth",
      expires: NOW + 3_600_000,
    });
    release();
    await expect(p).resolves.toMatchObject({ accessToken: "ACCESS-reauth" });
    expect(google.calls).toHaveLength(1);
  });

  it("the host's (payload, meta) call shape does not disable the retry", async () => {
    const { lease } = setup({});
    const call = lease as unknown as (p: unknown, m: unknown) => Promise<unknown>;
    await expect(call({ account: "work", op: "read" }, { sessionId: "x" })).resolves.toMatchObject({ tier: "send" });
  });

  it("invalid_grant for a grant already replaced by a re-auth does not mark reauth_required", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { lease, store, creds } = setup({
      expiresIn: 0,
      refresh: async () => {
        await gate;
        return { status: 400, body: { error: "invalid_grant" } };
      },
    });
    const p = lease({ account: "work", op: "read" });
    await new Promise((r) => setTimeout(r, 5));
    await store.upsertFromSignIn({
      sub: "s1",
      email: "a@x.com",
      tier: "send",
      scopes: [SCOPE.modify],
      access: "ACCESS-reauth",
      refresh: "REFRESH-reauth",
      expires: NOW + 3_600_000,
    });
    release();
    // Retried once against the new (still valid) grant → usable token.
    await expect(p).resolves.toMatchObject({ accessToken: "ACCESS-reauth" });
    expect(creds.data.get(acctKey("s1"))?.status).toBe("ok");
  });
});
