import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { AccessPlaneRegistry, type DeferredAccessPlane, type HeldAccessPlane } from "../access-plane.js";
import { type DenialContext, GrantCoordinator, type GrantCoordinatorDeps } from "../grant-coordinator.js";
import { GRANT_ENTRY_TTL_MS } from "../pending-grant-registry.js";

/**
 * The coordinator (change: add-access-grant-dialog, tasks 6.1-6.3; test-plan
 * #E8, #E9, #E51, #X1, #X2, #X5, #F1, #F3).
 */

type GrantFn = HeldAccessPlane["grant"];
const okGrant = (): Mock<GrantFn> => vi.fn<GrantFn>(async () => ({ ok: true, store: "access-grants.json" }));

const heldPlane = (grant: GrantFn = okGrant()) =>
  ({
    id: "filesystem",
    mode: "held",
    yoloEligible: true,
    store: "access-grants.json",
    subjectOf: (raw: string) => raw || null,
    keyOf: (s: string) => s,
    describe: () => ({ mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "access-grants.json" }),
    grant,
  }) satisfies HeldAccessPlane;

const netPlane = (): DeferredAccessPlane => ({
  id: "network",
  mode: "deferred",
  store: "config.trustedNetworks",
  subjectOf: (raw) => raw || null,
  keyOf: (s) => s,
  describe: () => ({ mode: "deferred", verdicts: ["allow-always", "deny"], store: "config.trustedNetworks" }),
  grant: vi.fn(async () => ({ ok: true as const, store: "config.trustedNetworks" })),
});

let sent: ServerToBrowserMessage[];
let clock: number;
let scheduled: Array<{ fn: () => void; at: number; cancelled: boolean }>;
let grant: Mock<GrantFn>;

function make(over: Partial<GrantCoordinatorDeps> = {}) {
  const planes = new AccessPlaneRegistry();
  grant = okGrant();
  planes.register(heldPlane(grant));
  planes.register(netPlane());
  return new GrantCoordinator({
    planes,
    broadcast: (m) => sent.push(m),
    hostGateMode: () => "enforce",
    promptEnabled: () => true,
    killSwitch: () => false,
    operatorChannels: () => 1,
    onTransition: () => {},
    now: () => clock,
    schedule: (fn, ms) => {
      const job = { fn, at: clock + ms, cancelled: false };
      scheduled.push(job);
      return { cancel: () => (job.cancelled = true) };
    },
    ...over,
  });
}

/** Advance the clock and run due timers. */
function advance(ms: number) {
  clock += ms;
  for (const j of scheduled) if (!j.cancelled && j.at <= clock) {
    j.cancelled = true;
    j.fn();
  }
}

const fsDenial = (over: Partial<DenialContext> = {}): DenialContext => ({
  plane: "filesystem",
  rawSubject: "/work/repo",
  origin: "session-1",
  channel: "sock-A",
  requestHoldsCapability: true,
  ...over,
});

const promptOf = () => {
  const m = sent.find((x) => x.type === "grant_request");
  if (m?.type !== "grant_request") throw new Error("no grant_request was sent");
  return m;
};
const answer = (verdict: string, subject?: string) => {
  const p = promptOf();
  return { promptId: p.promptId, plane: p.plane, subject: subject ?? p.subject, verdict };
};

beforeEach(() => {
  sent = [];
  clock = 1_000_000;
  scheduled = [];
});

describe("held denial: suspended, then settled by the first answer", () => {
  it("holds, broadcasts the prompt, and releases on allow-once without persisting", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    expect(hold.held).toBe(true);
    expect(promptOf()).toMatchObject({ plane: "filesystem", subject: "/work/repo" });

    await c.onResponse(answer("allow-once"));
    expect(await hold.result).toEqual({ kind: "allow", verdict: "allow-once", subject: "/work/repo" });
    expect(grant).not.toHaveBeenCalled();
  });

  it("allow-always persists through the plane, attributed to the denying session", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    await c.onResponse(answer("allow-always"));
    expect(await hold.result).toMatchObject({ kind: "allow", verdict: "allow-always" });
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ subject: "/work/repo", origin: "session-1" }));
  });

  it("an allow-always whose store write fails does NOT release the request (D11)", async () => {
    const planes = new AccessPlaneRegistry();
    planes.register(heldPlane(vi.fn<GrantFn>(async () => ({ ok: false, reason: "write-failed" }))));
    const c = make({ planes });
    const hold = c.onDenial(fsDenial(), true);
    await c.onResponse(answer("allow-always"));
    expect(await hold.result).toEqual({ kind: "deny", reason: "persist-failed:write-failed" });
  });

  it("deny resolves the held request as a deny", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    await c.onResponse(answer("deny"));
    expect(await hold.result).toEqual({ kind: "deny", reason: "denied" });
  });

  it("#F1 every client is told the prompt is settled, and a late answer changes nothing", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    await c.onResponse(answer("deny"));
    await c.onResponse(answer("allow-always"));
    expect(sent.filter((m) => m.type === "grant_dismiss")).toEqual([
      expect.objectContaining({ reason: "settled" }),
    ]);
    expect(await hold.result).toEqual({ kind: "deny", reason: "denied" });
    expect(grant).not.toHaveBeenCalled();
  });

  it("coalesced held requests are all released by one verdict", async () => {
    const c = make();
    const a = c.onDenial(fsDenial(), true);
    const b = c.onDenial(fsDenial(), true);
    expect(b.held).toBe(true);
    await c.onResponse(answer("allow-once"));
    expect((await a.result).kind).toBe("allow");
    expect((await b.result).kind).toBe("allow");
  });
});

describe("a hold always ends in a deny unless the operator allows", () => {
  it("#X2 / #F3 expiry denies and dismisses the dialog", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    advance(GRANT_ENTRY_TTL_MS + 1);
    expect(await hold.result).toEqual({ kind: "deny", reason: "expired" });
    expect(sent.at(-1)).toMatchObject({ type: "grant_dismiss", reason: "expired" });
    expect(c.registry.size).toBe(0);
  });

  it("#X1 client abort releases the entry and denies, nothing persisted", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    hold.abort();
    expect(await hold.result).toEqual({ kind: "deny", reason: "aborted" });
    expect(c.registry.size).toBe(0);
    expect(sent.at(-1)).toMatchObject({ type: "grant_dismiss" });
    expect(grant).not.toHaveBeenCalled();
  });

  it("one coalesced requester aborting leaves the other waiting", async () => {
    const c = make();
    const a = c.onDenial(fsDenial(), true);
    const b = c.onDenial(fsDenial(), true);
    a.abort();
    expect(c.registry.size).toBe(1);
    await c.onResponse(answer("allow-once"));
    expect((await b.result).kind).toBe("allow");
  });

  it("#E51 report mode: no dialog on any channel, not held, reason names the mode", async () => {
    const c = make({ hostGateMode: () => "report" });
    const hold = c.onDenial(fsDenial(), true);
    expect(hold.held).toBe(false);
    expect(await hold.result).toEqual({ kind: "deny", reason: "report-mode" });
    expect(sent.filter((m) => m.type === "grant_request")).toEqual([]);
    expect(c.registry.size).toBe(1);
  });

  it("a site that cannot suspend never holds, even when the precondition passes", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), false);
    expect(hold.held).toBe(false);
    expect((await hold.result).kind).toBe("deny");
  });

  it("a flooded entry is not held: nobody is being asked about it", async () => {
    const c = make();
    c.onDenial(fsDenial({ rawSubject: "/a" }), true);
    const second = c.onDenial(fsDenial({ rawSubject: "/b" }), true);
    expect(second.held).toBe(false);
    expect(await second.result).toEqual({ kind: "deny", reason: "channel-concurrent" });
  });
});

describe("deferred denial: prompts on the operator channel, never suspends", () => {
  const net: DenialContext = {
    plane: "network",
    rawSubject: "203.0.113.9",
    origin: "network",
    channel: "203.0.113.9",
    requestHoldsCapability: false,
  };

  it("#E9 prompts when an operator channel is live, and the request stays denied", async () => {
    const c = make();
    const hold = c.onDenial(net, true);
    expect(hold.held).toBe(false);
    expect((await hold.result).kind).toBe("deny");
    expect(promptOf()).toMatchObject({ plane: "network", copy: { mode: "deferred" } });
  });

  it("#E8 no operator channel: no prompt, still recorded", async () => {
    const c = make({ operatorChannels: () => 0 });
    c.onDenial(net, true);
    expect(sent).toEqual([]);
    expect(c.registry.list(clock)[0]).toMatchObject({ subject: "203.0.113.9", suppressedBy: "no-audience" });
  });
});

describe("robustness", () => {
  it("#X5 an undeliverable prompt leaves the denial standing, recorded, and unheld", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = make({
      broadcast: () => {
        throw new Error("gateway down");
      },
    });
    const hold = c.onDenial(fsDenial(), true);
    expect(hold.held).toBe(false);
    expect(await hold.result).toEqual({ kind: "deny", reason: "broadcast-failed" });
    expect(c.registry.size).toBe(1);
    spy.mockRestore();
  });

  it("a dismissal that cannot be delivered still releases the held request", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = false;
    const c = make({
      broadcast: (m) => {
        if (fail) throw new Error("gateway down");
        sent.push(m);
      },
    });
    const hold = c.onDenial(fsDenial(), true);
    fail = true;
    await c.onResponse(answer("allow-once"));
    expect((await hold.result).kind).toBe("allow");
    spy.mockRestore();
  });

  it("an unknown plane or an unpromptable subject denies without recording", async () => {
    const c = make();
    expect(await c.onDenial({ ...net(), plane: "cors" }, true).result).toEqual({ kind: "deny", reason: "unknown-plane" });
    expect(await c.onDenial(fsDenial({ rawSubject: "" }), true).result).toEqual({
      kind: "deny",
      reason: "not-promptable",
    });
    expect(c.registry.size).toBe(0);
  });

  it("a malformed response is ignored", async () => {
    const c = make();
    const hold = c.onDenial(fsDenial(), true);
    await c.onResponse({ nonsense: true });
    await c.onResponse(null);
    expect(c.registry.size).toBe(1);
    hold.abort();
  });
});

function net(): DenialContext {
  return { plane: "network", rawSubject: "1.2.3.4", origin: "network", channel: "1.2.3.4", requestHoldsCapability: false };
}
