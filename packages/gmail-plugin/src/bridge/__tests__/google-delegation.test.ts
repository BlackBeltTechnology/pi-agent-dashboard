/**
 * Gmail tools over Google Connect: accounts come from `google/accounts`, tokens from `google/lease`, and every
 * refusal reads as the Gmail error the tools already know. Harness copied from `tools.test.ts`; the legacy side
 * runs the REAL Gmail lease handler so each tier/option is compared against it, not against a re-typed table
 * (test-plan B124, B125, B127, B129, B130, B131). See change: add-google-connect.
 */
import { describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, memoryCredentials, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { AccountStore, acctKey, CLIENT_KEY, summarize } from "../../server/accounts.js";
import { createLeaseHandler } from "../../server/lease.js";
import { ACCOUNTS_TYPE, GOOGLE_ACCOUNTS_TYPE, GOOGLE_LEASE_TYPE, LEASE_TYPE } from "../../shared/protocol.js";
import { SCOPE, TIER_SCOPES, type Tier } from "../../shared/scopes.js";
import { type GmailToolError, type LaneRequest, LeaseClient } from "../lease-client.js";
import { createGmailTools, type GmailToolDef, type ToolContext } from "../tools.js";

type Reply = Awaited<ReturnType<LaneRequest>>;

interface GAcct {
  sub: string;
  email: string;
  alias?: string;
  status?: "ok" | "reauth_required";
  gmail?: { level: Tier; filters?: boolean };
  /** Make `google/lease` refuse with this raw lane error. */
  refuse?: string;
}

const googleRow = (a: GAcct) => ({
  sub: a.sub,
  email: a.email,
  ...(a.alias ? { alias: a.alias } : {}),
  status: a.status ?? "ok",
  addedAt: 1,
  products: a.gmail ? { gmail: { level: a.gmail.level, ...(a.gmail.filters ? { options: { filters: true } } : {}) } } : {},
});

/** The slice of the real `google/lease` order that matters to Gmail: resolve → refusal → product off → reauth → grant. */
function leaseReply(list: GAcct[], ref: string): Reply {
  const key = ref.trim().toLowerCase();
  const hits = list.filter((a) => a.alias?.toLowerCase() === key || a.email.toLowerCase() === key || a.sub === ref);
  if (hits.length === 0) return { ok: false, error: `not_found: No Google account matches "${key}"` };
  if (hits.length > 1) return { ok: false, error: `ambiguous: Several connected accounts share ${key}; use the alias in Settings → Google accounts.` };
  const a = hits[0] as GAcct;
  if (a.refuse) return { ok: false, error: a.refuse };
  if (!a.gmail) return { ok: false, error: `product_disabled: gmail is off for ${a.email} in Settings → Google accounts` };
  if (a.status === "reauth_required") return { ok: false, error: "reauth_required: sign in again in Settings → Google accounts" };
  return {
    ok: true,
    result: { accessToken: `G-ACCESS-${a.sub}`, expiresAt: Date.now() + 3_600_000, email: a.email, level: a.gmail.level, options: a.gmail.filters ? { filters: true } : {} },
  } as Reply;
}

function googleLane(list: GAcct[]) {
  const seen: string[] = [];
  const request: LaneRequest = async (plugin, type, payload) => {
    seen.push(`${plugin}:${type}`);
    if (plugin === "gmail") return { ok: true, result: { delegate: "google" } } as Reply;
    if (type === GOOGLE_ACCOUNTS_TYPE) return { ok: true, result: list.map(googleRow) } as Reply;
    if (type === GOOGLE_LEASE_TYPE) return leaseReply(list, String((payload as { account: string }).account));
    return { ok: false, error: "no_handler" };
  };
  return { request, seen };
}

/** The pre-change lane: real Gmail account store + real Gmail lease handler. */
function legacyLane(a: { sub: string; email: string; alias?: string; tier: Tier; filters?: boolean }) {
  const store = new AccountStore(
    memoryCredentials({
      [CLIENT_KEY]: { ...CLIENT },
      [acctKey(a.sub)]: {
        sub: a.sub,
        email: a.email,
        ...(a.alias ? { alias: a.alias } : {}),
        tier: a.tier,
        scopes: [...TIER_SCOPES[a.tier], ...(a.filters ? [SCOPE.settingsBasic] : [])],
        ...(a.filters ? { filters: true } : {}),
        refresh: "R",
        access: `ACCESS-${a.sub}`,
        expires: Date.now() + 3_600_000,
        status: "ok",
        addedAt: 1,
      },
    }),
  );
  const lease = createLeaseHandler({ store, endpoints: TEST_ENDPOINTS, logger: capturingLogger() });
  const request: LaneRequest = async (_p, type, payload) => {
    try {
      if (type === LEASE_TYPE) return { ok: true, result: await lease(payload) };
      if (type === ACCOUNTS_TYPE) return { ok: true, result: (await store.list()).map(summarize) };
      return { ok: false, error: "no_handler" };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };
  return request;
}

const HDR = [{ name: "Subject", value: "Hello" }, { name: "From", value: "b@y.com" }];

function fakeGmail() {
  const calls: string[] = [];
  const tokens: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    tokens.push(String((init?.headers as Record<string, string> | undefined)?.authorization ?? (init?.headers as Record<string, string> | undefined)?.Authorization ?? ""));
    const p = url.pathname;
    let body: unknown = {};
    if (p.endsWith("/messages") && init?.method !== "POST") body = { messages: [{ id: "m1", threadId: "t1" }] };
    else if (p.endsWith("/messages/m1")) body = { id: "m1", threadId: "t1", snippet: "hi", payload: { headers: HDR } };
    else if (p.endsWith("/messages/send")) body = { id: "sent1", threadId: "tNew" };
    else if (p.endsWith("/drafts")) body = { id: "d1" };
    else if (p.endsWith("/settings/filters")) body = { filter: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls, tokens };
}

function toolsOver(request: LaneRequest) {
  const gmail = fakeGmail();
  const tools = createGmailTools({ leases: new LeaseClient(request), endpoints: TEST_ENDPOINTS, fetchImpl: gmail.fetchImpl });
  const confirm = vi.fn(async () => true);
  const ctx = { hasUI: true, ui: { confirm }, cwd: process.cwd() } as ToolContext;
  const run = (name: string, params: Record<string, unknown>) =>
    (tools.find((t) => t.name === name) as GmailToolDef).execute("id", params, undefined, undefined, ctx);
  return { tools, run, gmail, confirm };
}

/** Outcome of one tool call: success text, or the Gmail error's code and exact message. */
async function outcome(run: ReturnType<typeof toolsOver>["run"], name: string, params: Record<string, unknown>) {
  try {
    const r = await run(name, params);
    return { ok: true as const, text: r.content[0]?.text as string };
  } catch (e) {
    const err = e as GmailToolError;
    return { ok: false as const, code: err.code, message: err.message };
  }
}

const OPS: Array<[string, string, Record<string, unknown>]> = [
  ["read", "gmail_search", { account: "a@x.com", query: "x" }],
  ["draft", "gmail_draft", { account: "a@x.com", to: ["p@q.com"], subject: "S", body: "b" }],
  ["send", "gmail_send", { account: "a@x.com", to: ["p@q.com"], subject: "S", body: "b" }],
  ["modify", "gmail_modify", { account: "a@x.com", ids: ["m1"], addLabels: ["INBOX"] }],
  ["trash", "gmail_trash", { account: "a@x.com", ids: ["m1"] }],
  ["filters_read", "gmail_filters_list", { account: "a@x.com" }],
];

describe("B124 — Gmail accounts come from Google Connect", () => {
  it("`a@x.com` Gmail=draft: gmail_accounts lists it, gmail_send is refused as above its level, no Gmail request", async () => {
    const lane = googleLane([{ sub: "s1", email: "a@x.com", gmail: { level: "draft" } }]);
    const { run, gmail } = toolsOver(lane.request);
    const listed = await run("gmail_accounts", {});
    expect(listed.content[0]?.text).toContain("<a@x.com> level=draft status=ok");
    const e = await outcome(run, "gmail_send", OPS[2]?.[2] as Record<string, unknown>);
    expect(e).toEqual({ ok: false, code: "tier_denied", message: 'tier_denied: a@x.com is at level "draft", which does not allow "send"' });
    expect(gmail.calls).toHaveLength(0);
    // Tokens came from the google lane, never a legacy `gmail/lease` beyond the delegation hop.
    expect(lane.seen).toContain("google:google/lease");
  });
});

describe("B125 — tier / option decision table equals the legacy lane", () => {
  const tiers: Tier[] = ["readonly", "draft", "send"];
  for (const tier of tiers) {
    for (const filters of [false, true]) {
      it(`level ${tier}, filters ${filters ? "on" : "off"}: every tool behaves as on the legacy lane`, async () => {
        const legacy = toolsOver(legacyLane({ sub: "s1", email: "a@x.com", tier, filters }));
        const google = toolsOver(googleLane([{ sub: "s1", email: "a@x.com", gmail: { level: tier, filters } }]).request);
        for (const [, name, params] of OPS) {
          const want = await outcome(legacy.run, name, params);
          const got = await outcome(google.run, name, params);
          expect(got, `${name} @${tier}/${filters}`).toEqual(want);
        }
        // The decision table is non-trivial: send is only allowed at the send level.
        expect((await outcome(google.run, "gmail_send", OPS[2]?.[2] as Record<string, unknown>)).ok).toBe(tier === "send");
        expect((await outcome(google.run, "gmail_filters_list", { account: "a@x.com" })).ok).toBe(filters);
      });
    }
  }

  it("Gmail off: the account is not a Gmail account (not listed); Gmail on elsewhere still is", async () => {
    const lane = googleLane([
      { sub: "s1", email: "a@x.com" },
      { sub: "s2", email: "b@y.com", gmail: { level: "readonly" } },
    ]);
    const { run } = toolsOver(lane.request);
    const text = (await run("gmail_accounts", {})).content[0]?.text as string;
    expect(text).not.toContain("a@x.com");
    expect(text).toContain("<b@y.com> level=readonly");
  });

  it("the lease itself is authoritative: filters off at lease time refuses even if the account list said on", async () => {
    const lane = googleLane([{ sub: "s1", email: "a@x.com", gmail: { level: "send" } }]);
    const stale: LaneRequest = async (plugin, type, payload) =>
      type === GOOGLE_ACCOUNTS_TYPE ? ({ ok: true, result: [googleRow({ sub: "s1", email: "a@x.com", gmail: { level: "send", filters: true } })] } as Reply) : lane.request(plugin, type, payload);
    const { run, gmail } = toolsOver(stale);
    expect(await outcome(run, "gmail_filters_list", { account: "a@x.com" })).toMatchObject({ ok: false, code: "filters_disabled" });
    expect(gmail.calls).toHaveLength(0);
  });

  it("filters off → filter tools refused with filters_disabled before any Gmail request", async () => {
    const { run, gmail } = toolsOver(googleLane([{ sub: "s1", email: "a@x.com", gmail: { level: "send" } }]).request);
    const e = await outcome(run, "gmail_filters_list", { account: "a@x.com" });
    expect(e).toMatchObject({ ok: false, code: "filters_disabled" });
    expect(gmail.calls).toHaveLength(0);
  });
});

describe("B127 — same Gmail REST requests as before", () => {
  it("search/draft/send/modify/trash hit the same Gmail paths; only the bearer token differs", async () => {
    const legacy = toolsOver(legacyLane({ sub: "s1", email: "a@x.com", tier: "send" }));
    const google = toolsOver(googleLane([{ sub: "s1", email: "a@x.com", gmail: { level: "send" } }]).request);
    for (const [, name, params] of OPS.slice(0, 5)) {
      await legacy.run(name, params);
      await google.run(name, params);
    }
    expect(google.gmail.calls.length).toBeGreaterThan(5);
    expect(google.gmail.calls).toEqual(legacy.gmail.calls);
    expect(new Set(google.gmail.tokens)).toEqual(new Set(["Bearer G-ACCESS-s1"]));
    expect(legacy.tools.map((t) => t.name)).toEqual(google.tools.map((t) => t.name));
  });
});

describe("B129 — refusals read as the pre-change Gmail errors", () => {
  const a = { sub: "s1", email: "a@x.com" };
  const search = { account: "a@x.com", query: "x" };

  it("level_insufficient (level below the tool) → the legacy tier_denied, no Gmail request", async () => {
    const { run, gmail } = toolsOver(googleLane([{ ...a, gmail: { level: "readonly" } }]).request);
    const got = await outcome(run, "gmail_draft", OPS[1]?.[2] as Record<string, unknown>);
    const legacy = await outcome(toolsOver(legacyLane({ ...a, tier: "readonly" })).run, "gmail_draft", OPS[1]?.[2] as Record<string, unknown>);
    expect(got).toEqual(legacy);
    expect(got).toMatchObject({ code: "tier_denied" });
    expect(gmail.calls).toHaveLength(0);
  });

  it("level_insufficient answered by google/lease itself maps to the same tier_denied", async () => {
    const refuse = 'level_insufficient: gmail is set to "readonly" for a@x.com; raise it in Settings → Google accounts';
    const { run } = toolsOver(googleLane([{ ...a, gmail: { level: "readonly" }, refuse }]).request);
    expect(await outcome(run, "gmail_search", search)).toEqual({
      ok: false,
      code: "tier_denied",
      message: 'tier_denied: a@x.com is at level "readonly", which does not allow "read"',
    });
  });

  it("product_disabled → exactly \"Gmail is off for a@x.com in Settings → Google accounts\"", async () => {
    const { run } = toolsOver(googleLane([a]).request);
    expect(await outcome(run, "gmail_search", search)).toEqual({
      ok: false,
      code: "not_found",
      message: "not_found: Gmail is off for a@x.com in Settings → Google accounts",
    });
  });

  for (const code of ["default_client_unavailable", "no_client"]) {
    it(`${code} → the existing no_client text`, async () => {
      const legacyErr = await outcome(toolsOver(async () => ({ ok: false, error: "no_client: the Gmail OAuth client is not configured" })).run, "gmail_search", search);
      const { run } = toolsOver(googleLane([{ ...a, gmail: { level: "send" }, refuse: `${code}: no OAuth client` }]).request);
      const got = await outcome(run, "gmail_search", search);
      expect(got).toEqual({ ok: false, code: "no_client", message: "no_client: the Gmail OAuth client is not configured" });
      expect(got).toEqual(legacyErr);
    });
  }

  it("reauth_required → the legacy re-authentication message for the email", async () => {
    const { run } = toolsOver(googleLane([{ ...a, gmail: { level: "send" }, status: "reauth_required" }]).request);
    expect(await outcome(run, "gmail_search", search)).toEqual({
      ok: false,
      code: "reauth_required",
      message: "reauth_required: a@x.com needs re-authentication in the Gmail panel",
    });
  });

  it("origin_denied passes through with its code, one delegation hop, no Gmail request", async () => {
    const seen: string[] = [];
    const request: LaneRequest = async (plugin, type) => {
      seen.push(`${plugin}:${type}`);
      if (plugin === "gmail") return { ok: true, result: { delegate: "google" } } as Reply;
      return { ok: false, error: "origin_denied: this handler is available to hub-local sessions only" };
    };
    const { run, gmail } = toolsOver(request);
    expect(await outcome(run, "gmail_search", search)).toMatchObject({ ok: false, code: "origin_denied" });
    expect(gmail.calls).toHaveLength(0);
    expect(seen).toEqual(["gmail:gmail/lease", "google:google/lease"]);
  });
});

describe("B130 — the refusal names the email, not the alias", () => {
  it("Gmail off for a@x.com with alias Work: by alias and by email the message is identical", async () => {
    const { run, gmail } = toolsOver(googleLane([{ sub: "s1", email: "a@x.com", alias: "Work" }]).request);
    const want = { ok: false, code: "not_found", message: "not_found: Gmail is off for a@x.com in Settings → Google accounts" };
    expect(await outcome(run, "gmail_search", { account: "Work", query: "x" })).toEqual(want);
    expect(await outcome(run, "gmail_search", { account: "a@x.com", query: "x" })).toEqual(want);
    expect(want.message).not.toMatch(/Work|410|moved/i);
    expect(gmail.calls).toHaveLength(0);
  });
});

describe("B131 — ambiguous / not_found keep the Gmail wording", () => {
  it("not_found for an unknown account equals the legacy message (known accounts listed)", async () => {
    const q = { account: "nobody", query: "x" };
    const legacy = await outcome(toolsOver(legacyLane({ sub: "s1", email: "a@x.com", alias: "work", tier: "send" })).run, "gmail_search", q);
    const got = await outcome(toolsOver(googleLane([{ sub: "s1", email: "a@x.com", alias: "work", gmail: { level: "send" } }]).request).run, "gmail_search", q);
    expect(got).toEqual(legacy);
    expect(got).toMatchObject({ code: "not_found", message: expect.stringContaining('No connected Gmail account matches "nobody". Known accounts: work (a@x.com).') });
  });

  it("ambiguous email equals the legacy message", async () => {
    const q = { account: "a@x.com", query: "x" };
    const legacyStore = new AccountStore(
      memoryCredentials({
        [CLIENT_KEY]: { ...CLIENT },
        ...Object.fromEntries(
          ["s1", "s2"].map((sub) => [
            acctKey(sub),
            { sub, email: "a@x.com", tier: "send", scopes: [...TIER_SCOPES.send], refresh: "R", access: "A", expires: Date.now() + 3_600_000, status: "ok", addedAt: 1 },
          ]),
        ),
      }),
    );
    const lease = createLeaseHandler({ store: legacyStore, endpoints: TEST_ENDPOINTS, logger: capturingLogger() });
    const legacyRequest: LaneRequest = async (_p, type, payload) => {
      try {
        if (type === LEASE_TYPE) return { ok: true, result: await lease(payload) };
        return { ok: true, result: (await legacyStore.list()).map(summarize) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    };
    const want = await outcome(toolsOver(legacyRequest).run, "gmail_search", q);
    const got = await outcome(
      toolsOver(googleLane([
        { sub: "s1", email: "a@x.com", gmail: { level: "send" } },
        { sub: "s2", email: "a@x.com", gmail: { level: "send" } },
      ]).request).run,
      "gmail_search",
      q,
    );
    expect(want).toMatchObject({ code: "ambiguous" });
    expect(got).toEqual(want);
  });
});
