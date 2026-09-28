/**
 * L1 bridge tool tests against the REAL lease handler (in-memory credential
 * store, private-lane fake) and a mocked Gmail REST (test-plan E15, E18–E25,
 * X6; tasks 3.1–3.3). See change: add-gmail-plugin.
 */
import { describe, expect, it, vi } from "vitest";
import { capturingLogger, CLIENT, memoryCredentials, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { AccountStore, acctKey, CLIENT_KEY, summarize } from "../../server/accounts.js";
import { createLeaseHandler } from "../../server/lease.js";
import { ACCOUNTS_TYPE, LEASE_TYPE } from "../../shared/protocol.js";
import { SCOPE, type Tier, TIER_SCOPES } from "../../shared/scopes.js";
import { GmailToolError, type LaneRequest, LeaseClient } from "../lease-client.js";
import { createGmailTools, type GmailToolDef, type ToolContext } from "../tools.js";

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function acct(sub: string, email: string, tier: Tier, alias?: string) {
  return {
    sub,
    email,
    ...(alias ? { alias } : {}),
    tier,
    scopes: [...TIER_SCOPES[tier]],
    refresh: `REFRESH-${sub}`,
    access: `ACCESS-${sub}`,
    expires: Date.now() + 3_600_000,
    status: "ok",
    addedAt: sub === "s1" ? 1 : 2,
  };
}

interface GmailCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function fakeGmail(opts: { status?: number; retryAfter?: string; html?: boolean } = {}) {
  const calls: GmailCall[] = [];
  const base = `${TEST_ENDPOINTS.gmail}/users/me/`;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.href.slice(base.length);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method: init?.method ?? "GET", path, body });
    if (opts.status) {
      return new Response("{}", { status: opts.status, headers: opts.retryAfter ? { "retry-after": opts.retryAfter } : {} });
    }
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    const headers = [
      { name: "From", value: "Bob <bob@y.com>" },
      { name: "To", value: "a@x.com, carol@z.com" },
      { name: "Subject", value: "Hello" },
      { name: "Date", value: "Mon, 1 Jan 2026 10:00:00 +0000" },
      { name: "Message-ID", value: "<m1@x>" },
      { name: "References", value: "<m0@x>" },
    ];
    if (url.pathname.endsWith("/messages") && init?.method !== "POST") return json({ messages: [{ id: "m1", threadId: "t1" }] });
    if (url.pathname.endsWith("/messages/m1")) {
      const payload =
        url.searchParams.get("format") === "full"
          ? {
              mimeType: "multipart/mixed",
              headers,
              parts: opts.html
                ? [{ mimeType: "text/html", body: { data: b64u("<p>hi <span style='display:none'>x</span></p>") } }]
                : [
                    { mimeType: "text/plain", body: { data: b64u("hi there") } },
                    { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "att1", size: 3 } },
                  ],
            }
          : { headers };
      return json({ id: "m1", threadId: "t1", snippet: "hi…", payload });
    }
    if (url.pathname.endsWith("/labels")) return json({ labels: [{ id: "INBOX", name: "INBOX" }] });
    if (url.pathname.endsWith("/attachments/att1")) return json({ data: b64u("PDF"), size: 3 });
    if (url.pathname.endsWith("/messages/send")) return json({ id: "sent1", threadId: body?.threadId ?? "tNew" });
    if (url.pathname.endsWith("/drafts")) return json({ id: "d1" });
    return json({});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function setup(opts: { tier?: Tier; gmail?: Parameters<typeof fakeGmail>[0] } = {}) {
  const creds = memoryCredentials({
    [CLIENT_KEY]: { ...CLIENT },
    [acctKey("s1")]: acct("s1", "a@x.com", opts.tier ?? "send", "work"),
    [acctKey("s2")]: acct("s2", "b@y.com", "readonly"),
  });
  const store = new AccountStore(creds);
  const lease = createLeaseHandler({ store, endpoints: TEST_ENDPOINTS, logger: capturingLogger() });
  const laneTypes: string[] = [];
  const request: LaneRequest = async (_plugin, type, payload) => {
    laneTypes.push(type);
    try {
      if (type === LEASE_TYPE) return { ok: true, result: await lease(payload) };
      if (type === ACCOUNTS_TYPE) return { ok: true, result: (await store.list()).map(summarize) };
      return { ok: false, error: "no_handler" };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };
  const gmail = fakeGmail(opts.gmail);
  const tools = createGmailTools({ leases: new LeaseClient(request), endpoints: TEST_ENDPOINTS, fetchImpl: gmail.fetchImpl });
  const tool = (name: string) => tools.find((t) => t.name === name) as GmailToolDef;
  const run = (name: string, params: Record<string, unknown>, ctx?: ToolContext) => tool(name).execute("id", params, undefined, undefined, ctx);
  return { store, gmail, laneTypes, run, tool, tools };
}

const ui = (answer: boolean | (() => Promise<boolean>)) => {
  const confirm = vi.fn(async () => (typeof answer === "function" ? answer() : answer));
  return { ctx: { hasUI: true, ui: { confirm }, cwd: process.cwd() } as ToolContext, confirm };
};

describe("E18 — gmail_accounts", () => {
  it("lists both accounts with level + status and is not untrusted", async () => {
    const { run } = setup();
    const r = await run("gmail_accounts", {});
    expect(r.content[0]?.text).toContain("work <a@x.com> level=send status=ok");
    expect(r.content[0]?.text).toContain("<b@y.com> level=readonly status=ok");
    expect(r.details.untrusted).toBeUndefined();
  });
});

describe("E19 — account required", () => {
  it("errors with the connected accounts and never requests a lease", async () => {
    const { run, laneTypes } = setup();
    const err = await run("gmail_search", { query: "x" }).catch((e: GmailToolError) => e);
    expect(err).toMatchObject({ code: "account_required" });
    expect((err as Error).message).toContain("work (a@x.com)");
    expect((err as Error).message).toContain("b@y.com");
    expect(laneTypes).not.toContain(LEASE_TYPE);
  });
});

describe("E20 — untrusted marking", () => {
  it("search/get/labels/attachments all set details.untrusted", async () => {
    const { run } = setup();
    for (const [name, p] of [
      ["gmail_search", { account: "work", query: "x" }],
      ["gmail_get", { account: "work", id: "m1" }],
      ["gmail_labels", { account: "work" }],
      ["gmail_attachments", { account: "work", messageId: "m1" }],
    ] as const) {
      const r = await run(name, p);
      expect(r.details.untrusted, name).toBe(true);
    }
  });
  it("an HTML body is returned with contentType text/html", async () => {
    const { run } = setup({ gmail: { html: true } });
    const r = await run("gmail_get", { account: "work", id: "m1" });
    expect(r.details.contentType).toBe("text/html");
    expect(r.content[0]?.text).toContain("<p>hi");
  });
});

describe("E22 — search limits", () => {
  it("schema bounds maxResults to 1–50", () => {
    const { tool } = setup();
    const props = (tool("gmail_search").parameters as { properties: Record<string, { minimum?: number; maximum?: number }> }).properties;
    expect(props.maxResults).toMatchObject({ minimum: 1, maximum: 50 });
  });
  it.each([
    [0, false],
    [1, true],
    [50, true],
    [51, false],
  ])("maxResults %i → accepted=%s (rejection before any lease)", async (n, ok) => {
    const { run, laneTypes } = setup();
    const r = run("gmail_search", { account: "work", maxResults: n });
    if (ok) {
      await expect(r).resolves.toBeDefined();
    } else {
      await expect(r).rejects.toMatchObject({ code: "invalid_params" });
      expect(laneTypes).not.toContain(LEASE_TYPE);
    }
  });
});

describe("E23 — confirm content", () => {
  it("shows account, both recipients, subject and a ≤500-char preview", async () => {
    const { run } = setup();
    const { ctx, confirm } = ui(true);
    await run("gmail_send", { account: "work", to: ["p@q.com", "r@s.com"], subject: "S", body: "x".repeat(5 * 1024) }, ctx);
    const [, message] = confirm.mock.calls[0] as unknown as [string, string];
    expect(message).toContain("work");
    expect(message).toContain("p@q.com, r@s.com");
    expect(message).toContain("Subject: S");
    const preview = message.split("\n\n").pop() as string;
    expect(preview.length).toBeLessThanOrEqual(501);
  });
});

describe("E24 — confirm outcomes", () => {
  const cases: Array<[string, ToolContext | undefined, number]> = [
    ["approved", ui(true).ctx, 1],
    ["denied", ui(false).ctx, 0],
    [
      "dismissed",
      ui(async () => {
        throw new Error("dismissed");
      }).ctx,
      0,
    ],
    ["timeout", ui(async () => new Promise<boolean>((r) => setTimeout(() => r(false), 10))).ctx, 0],
    ["headless", { hasUI: false, cwd: process.cwd() }, 0],
  ];
  it.each(cases)("%s → %i Gmail send call(s)", async (_label, ctx, sends) => {
    const { run, gmail } = setup();
    const r = run("gmail_send", { account: "work", to: ["p@q.com"], subject: "S", body: "b" }, ctx);
    if (sends) await expect(r).resolves.toBeDefined();
    else await expect(r).rejects.toBeInstanceOf(GmailToolError);
    expect(gmail.calls.filter((c) => c.path === "messages/send")).toHaveLength(sends);
  });
});

describe("E15 — downgrade applies to the very next call", () => {
  it("send → readonly, then gmail_send is refused tier_denied with no Gmail call", async () => {
    const { run, store, gmail } = setup();
    await store.setTier("s1", "readonly");
    const err = await run("gmail_send", { account: "work", to: ["p@q.com"], subject: "S", body: "b" }, ui(true).ctx).catch((e) => e);
    expect(err).toMatchObject({ code: "tier_denied" });
    expect(gmail.calls).toHaveLength(0);
  });

  it("the bridge re-checks the lease tier (defence in depth)", async () => {
    const request: LaneRequest = async () => ({
      ok: true,
      result: { accessToken: "t", expiresAt: Date.now() + 60_000, email: "a@x.com", tier: "readonly" },
    });
    await expect(new LeaseClient(request).lease("work", "send")).rejects.toMatchObject({ code: "tier_denied" });
  });

  it("scope-implied draft works on a send-tier modify grant", async () => {
    const { run } = setup();
    const r = await run("gmail_draft", { account: "work", to: ["p@q.com"], subject: "S", body: "b" }, ui(true).ctx);
    expect(r.details.draftId).toBe("d1");
    expect(SCOPE.modify).toContain("gmail.modify");
  });
});

describe("E25 — reply threading", () => {
  it("sets In-Reply-To, References and threadId", async () => {
    const { run, gmail } = setup();
    await run("gmail_reply", { account: "work", messageId: "m1", body: "thanks" }, ui(true).ctx);
    const send = gmail.calls.find((c) => c.path === "messages/send");
    expect(send?.body?.threadId).toBe("t1");
    const raw = Buffer.from(String(send?.body?.raw), "base64url").toString("utf8");
    expect(raw).toMatch(/^In-Reply-To: <m1@x>\r?$/m);
    expect(raw).toMatch(/^References: .*<m1@x>\r?$/m);
    expect(raw).toMatch(/^Subject: Re: Hello\r?$/m);
    expect(raw).toMatch(/^To: Bob <bob@y.com>\r?$/m);
  });
});

describe("X6 — Gmail 429", () => {
  it("reports rate-limited with retry-after and makes ≤ 1 call", async () => {
    const { run, gmail } = setup({ gmail: { status: 429, retryAfter: "2" } });
    const err = await run("gmail_search", { account: "work", query: "x" }).catch((e) => e);
    expect(err).toMatchObject({ code: "rate_limited" });
    expect((err as Error).message).toContain("retry after 2 s");
    expect(gmail.calls).toHaveLength(1);
  });
});
