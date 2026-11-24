/**
 * Gmail's delegated lease follows `google/lease` and surfaces transport failures and refusals as the existing
 * Gmail errors — never a hang, never a fallback to legacy tokens (test-plan B128, B129; scenario-gate B18, B24).
 * See change: add-google-connect.
 */
import { describe, expect, it, vi } from "vitest";
import { GmailToolError, type LaneRequest, LeaseClient } from "../lease-client.js";

type Reply = Awaited<ReturnType<LaneRequest>>;
const delegate: Reply = { ok: true, result: { delegate: "google" } } as Reply;
const err = async (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as GmailToolError);

function client(google: (type: string) => Reply | Promise<Reply>, accounts: unknown[] = []) {
  const request = vi.fn(async (plugin: string, type: string): Promise<Reply> => {
    if (plugin === "gmail") return delegate;
    if (type === "google/accounts") return { ok: true, result: accounts } as Reply;
    return google(type);
  });
  return { request, lease: new LeaseClient(request as LaneRequest) };
}

describe("delegated lease failures (B128, GB18)", () => {
  for (const error of ["unavailable", "timeout"]) {
    it(`B128: a \`google/lease\` transport failure (${error}) is a Gmail-style error, with no legacy fallback`, async () => {
      const { request, lease } = client(() => ({ ok: false, error }) as Reply);
      const e = await err(lease.lease("alias-s1", "read"));
      expect(e).toBeInstanceOf(GmailToolError);
      expect(e?.code).toBe(error);
      expect(e?.message).not.toMatch(/ACCESS|REFRESH/);
      // Exactly the delegation hop — no second `gmail/lease` / legacy lease after the failure.
      expect(request.mock.calls.map((c) => `${c[0]}:${c[1]}`)).toEqual(["gmail:gmail/lease", "google:google/lease"]);
    });
  }

  it("GB18: the same failure for an imported account never reaches a legacy lease", async () => {
    const { request, lease } = client(() => ({ ok: false, error: "unavailable" }) as Reply);
    await err(lease.lease("a@x.com", "send"));
    expect(request.mock.calls.filter((c) => c[0] === "google").map((c) => c[1])).toEqual(["google/lease"]);
    expect(request.mock.calls.filter((c) => c[0] === "gmail")).toHaveLength(1);
  });
});

describe("refusal text (B129, GB24)", () => {
  it("GB24: `product_disabled` reads \"Gmail is off for <email> in Settings → Google accounts\"", async () => {
    const accounts = [{ sub: "s1", email: "a@x.com", alias: "work", status: "ok", addedAt: 1, products: {} }];
    const { lease } = client(() => ({ ok: false, error: "product_disabled: gmail is off for a@x.com in Settings → Google accounts" }) as Reply, accounts);
    const e = await err(lease.lease("work", "read"));
    expect(e?.message).toContain("Gmail is off for a@x.com in Settings → Google accounts");
  });
});
