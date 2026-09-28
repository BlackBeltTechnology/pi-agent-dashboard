import { describe, expect, it, vi } from "vitest";
import {
  type AccessPlane,
  AccessPlaneRegistry,
  type DeferredAccessPlane,
  type HeldAccessPlane,
  holdsRequest,
  type PreconditionInput,
  persistVerdict,
  promptPrecondition,
} from "../access-plane.js";
import { PendingGrantRegistry } from "../pending-grant-registry.js";

/**
 * The plane seam (change: add-access-grant-dialog, tasks 5.1, 5.5, 2b.2, 8b.1;
 * test-plan #E8, #E9, #E51-#E53, #X9).
 */

const fakeHeld = (over: Partial<HeldAccessPlane> = {}): HeldAccessPlane => ({
  id: "filesystem",
  mode: "held",
  yoloEligible: true,
  store: "fake-store",
  subjectOf: (raw) => raw || null,
  keyOf: (s) => s,
  describe: () => ({ mode: "held", verdicts: ["allow-once", "allow-always", "deny"], store: "fake-store" }),
  grant: vi.fn(async () => ({ ok: true as const, store: "fake-store" })),
  ...over,
});

const fakeDeferred = (over: Partial<DeferredAccessPlane> = {}): DeferredAccessPlane => ({
  id: "network",
  mode: "deferred",
  store: "fake-net",
  subjectOf: (raw) => raw || null,
  keyOf: (s) => s,
  describe: () => ({ mode: "deferred", verdicts: ["allow-always", "deny"], store: "fake-net" }),
  grant: vi.fn(async () => ({ ok: true as const, store: "fake-net" })),
  ...over,
});

const pre = (plane: AccessPlane, over: Partial<PreconditionInput> = {}): PreconditionInput => ({
  plane,
  hostGateMode: "enforce",
  promptEnabled: true,
  killSwitch: false,
  requestHoldsCapability: false,
  operatorChannels: 0,
  ...over,
});

describe("5.1 a registered plane drives a full record -> prompt -> settle cycle", () => {
  it("normalises, records, prompts, settles, and persists through the plane", async () => {
    const planes = new AccessPlaneRegistry();
    const plane = fakeHeld();
    planes.register(plane);
    const reg = new PendingGrantRegistry({ onTransition: () => {} });

    const p = planes.get("filesystem");
    if (!p) throw new Error("plane not registered");
    const subject = p.subjectOf("/work/repo");
    if (!subject) throw new Error("expected a subject");
    const precondition = promptPrecondition(pre(p, { requestHoldsCapability: true }));
    const out = reg.record({ plane: p.id, subject, mode: p.mode, channel: "sock", store: p.store }, precondition, 0);
    expect(out.kind).toBe("prompt");
    if (out.kind !== "prompt") return;

    const settled = reg.settle(
      { promptId: out.entry.promptId, plane: p.id, subject, verdict: "allow-always" },
      1,
    );
    if (!settled.ok) throw new Error("expected a settlement");
    const persisted = await persistVerdict(p, {
      verdict: settled.verdict,
      subject: settled.subject,
      deniedSubject: settled.entry.subject,
      ancestors: settled.entry.ancestors,
      origin: "session-1",
    });
    expect(persisted).toEqual({ persisted: true, ok: true, store: "fake-store" });
    expect(plane.grant).toHaveBeenCalledWith({
      subject: "/work/repo",
      deniedSubject: "/work/repo",
      ancestors: [],
      origin: "session-1",
    });
  });

  it("only allow-always persists: allow-once and deny write nothing", async () => {
    const plane = fakeHeld();
    for (const verdict of ["allow-once", "deny"] as const) {
      const r = await persistVerdict(plane, { verdict, subject: "/a", deniedSubject: "/a", ancestors: [], origin: "s" });
      expect(r).toEqual({ persisted: false });
    }
    expect(plane.grant).not.toHaveBeenCalled();
  });

  it("refuses a duplicate plane id", () => {
    const planes = new AccessPlaneRegistry();
    planes.register(fakeHeld());
    expect(() => planes.register(fakeHeld())).toThrow(/already registered/);
  });
});

describe("8b.1 / #X9 YOLO eligibility is unrepresentable on a deferred plane", () => {
  it("is a type error", () => {
    // @ts-expect-error: a DeferredAccessPlane admits only `yoloEligible?: false`
    const bad: DeferredAccessPlane = { ...fakeDeferred(), yoloEligible: true };
    expect(bad.mode).toBe("deferred");
  });

  it("is REJECTED at registration, not silently honoured", () => {
    const planes = new AccessPlaneRegistry();
    const bad = { ...fakeDeferred(), yoloEligible: true } as unknown as AccessPlane;
    expect(() => planes.register(bad)).toThrow(/may not be yolo-eligible/);
    expect(planes.get("network")).toBeUndefined();
  });

  it("an unknown mode is rejected", () => {
    const planes = new AccessPlaneRegistry();
    const bad = { ...fakeHeld(), mode: "sometimes" } as unknown as AccessPlane;
    expect(() => planes.register(bad)).toThrow(/unknown mode/);
  });
});

describe("5.5 declaring `held` never bypasses eligibility", () => {
  const held = fakeHeld();

  it("#E51 degrades under report mode even with a capability", () => {
    expect(promptPrecondition(pre(held, { hostGateMode: "report", requestHoldsCapability: true }))).toEqual({
      promptable: false,
      reason: "report-mode",
    });
  });

  it("degrades when the request holds no capability, however many operators are online", () => {
    expect(promptPrecondition(pre(held, { operatorChannels: 5 }))).toEqual({
      promptable: false,
      reason: "ineligible",
    });
  });

  it("#E53 is promptable, and so suspendable, only with capability AND enforce", () => {
    const p = promptPrecondition(pre(held, { requestHoldsCapability: true }));
    expect(p).toEqual({ promptable: true });
    expect(holdsRequest(held, p)).toBe(true);
  });

  it("disabled and the kill switch win over everything", () => {
    const all = { requestHoldsCapability: true, operatorChannels: 3 };
    expect(promptPrecondition(pre(held, { ...all, promptEnabled: false }))).toMatchObject({ reason: "disabled" });
    expect(promptPrecondition(pre(held, { ...all, killSwitch: true }))).toMatchObject({ reason: "disabled" });
  });
});

describe("2b.2 the proof differs by settlement mode", () => {
  const net = fakeDeferred();

  it("#E9 a deferred denial prompts on a live operator channel and asks nothing of the request", () => {
    const p = promptPrecondition(pre(net, { operatorChannels: 1, requestHoldsCapability: false }));
    expect(p).toEqual({ promptable: true });
  });

  it("#E8 a deferred denial with no operator channel does not prompt", () => {
    expect(promptPrecondition(pre(net, { operatorChannels: 0 }))).toEqual({
      promptable: false,
      reason: "no-audience",
    });
  });

  it("a deferred denial NEVER suspends, even when promptable", () => {
    const p = promptPrecondition(pre(net, { operatorChannels: 1, requestHoldsCapability: true }));
    expect(p.promptable).toBe(true);
    expect(holdsRequest(net, p)).toBe(false);
  });

  it("#E52 a deferred plane is equally gated by report mode", () => {
    expect(promptPrecondition(pre(net, { operatorChannels: 1, hostGateMode: "report" }))).toMatchObject({
      reason: "report-mode",
    });
  });
});
