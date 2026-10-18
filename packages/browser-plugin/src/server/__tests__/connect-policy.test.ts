/** `resolveBrowserConnect` — D6 table + policies (#E18 #E19 #R14). See change: add-dedicated-agent-browser. */
import { describe, expect, it, vi } from "vitest";
import type { ConnectOutcome, ConnectPolicyConfig, DedicatedStatusView, ProfileView } from "../agent-browser-types.js";
import { resolveBrowserConnect } from "../connect-policy.js";

const PROFILES: ProfileView[] = [
  { profileDirectory: "P", label: "Work", installed: true },
  { profileDirectory: "Q", label: "Other", installed: false },
];

interface Opts {
  config?: ConnectPolicyConfig;
  dedicated?: DedicatedStatusView;
  /** per-call outcomes */
  dedicatedConnect?: ConnectOutcome;
  profileConnect?: ConnectOutcome;
  profiles?: ProfileView[];
  sessionId?: string;
}

function setup(o: Opts = {}) {
  const status: DedicatedStatusView = o.dedicated ?? { available: true };
  const calls: string[] = [];
  const connectDedicated = vi.fn(async (_opts: { holder: string }) => {
    calls.push("connectDedicated");
    return o.dedicatedConnect ?? { ok: true as const, cdpUrl: "ws://d/1", instanceId: "ded-2" };
  });
  const connectProfile = vi.fn(async (_p: string) => {
    calls.push("connectProfile");
    return o.profileConnect ?? { ok: true as const, cdpUrl: "ws://p/1", instanceId: "prof-1" };
  });
  const disconnect = vi.fn(async (_id: string) => {
    calls.push("disconnect");
  });
  const remember = vi.fn();
  const deps = {
    sessionId: o.sessionId ?? "S",
    config: () => o.config ?? {},
    installedProfiles: () => o.profiles ?? PROFILES,
    dedicatedStatus: () => status,
    connectDedicated,
    connectProfile,
    disconnect,
    liveView: { remember },
  };
  return { deps, connectDedicated, connectProfile, disconnect, remember, calls };
}
const targets = (r: { attempts: Array<{ target: string }> }) => r.attempts.map((a) => a.target);

describe("#E18 resolution table (onUnavailable: next, first target unavailable)", () => {
  const busyProfile: ConnectOutcome = { ok: false, reason: "busy", status: 409 };
  const noChrome = { available: false, reason: "no-chrome" };

  it("@dedicated, realProfile unset → @dedicated, @headless; headless has no cdpUrl", async () => {
    const s = setup({ config: { onUnavailable: "next" }, dedicated: noChrome });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(targets(r as never)).toEqual(["@dedicated", "@headless"]);
    expect(r).toMatchObject({ browser: "headless" });
    expect("cdpUrl" in r).toBe(false);
    expect(s.connectDedicated).not.toHaveBeenCalled();
  });

  it("@dedicated, realProfile P → @dedicated, P, @headless", async () => {
    const s = setup({ config: { onUnavailable: "next", realProfile: "P" }, dedicated: noChrome, profileConnect: busyProfile });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(targets(r as never)).toEqual(["@dedicated", "P", "@headless"]);
    expect(r).toMatchObject({ browser: "headless" });
  });

  it("first target P == realProfile P → P, @dedicated, @headless (P tried once)", async () => {
    const s = setup({
      config: { onUnavailable: "next", defaultBrowser: "P", realProfile: "P" },
      dedicated: noChrome,
      profileConnect: busyProfile,
    });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(targets(r as never)).toEqual(["P", "@dedicated", "@headless"]);
    expect(s.connectProfile).toHaveBeenCalledTimes(1);
  });

  it("@headless → only @headless", async () => {
    const s = setup({ config: { onUnavailable: "next", defaultBrowser: "@headless", realProfile: "P" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(targets(r as never)).toEqual(["@headless"]);
    expect(r).toMatchObject({ browser: "headless" });
  });

  it("the target argument overrides defaultBrowser", async () => {
    const s = setup({ config: { onUnavailable: "next", defaultBrowser: "@dedicated", realProfile: "P" } });
    const r = await resolveBrowserConnect({ target: "@headless" }, s.deps);
    expect(targets(r as never)).toEqual(["@headless"]);
  });

  it("a recorded attempt names the failure reason; a later success is returned with its attempts", async () => {
    const s = setup({ config: { onUnavailable: "next", realProfile: "P" }, dedicated: { available: false, reason: "no-chrome" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toEqual({
      browser: "profile",
      profileDirectory: "P",
      instanceId: "prof-1",
      cdpUrl: "ws://p/1",
      liveView: true,
      attempts: [
        { target: "@dedicated", ok: false, reason: "no-chrome" },
        { target: "P", ok: true },
      ],
    });
  });

  it("a not-installed or unknown profile is skipped with a recorded reason and is never connected", async () => {
    for (const real of ["Q", "ZZ"]) {
      const s = setup({ config: { onUnavailable: "next", realProfile: real }, dedicated: { available: false, reason: "x" } });
      const r = await resolveBrowserConnect({}, s.deps);
      expect(r).toMatchObject({ browser: "headless" });
      expect((r as { attempts: unknown[] }).attempts[1]).toEqual({ target: real, ok: false, reason: "not-installed" });
      expect(s.connectProfile).not.toHaveBeenCalled();
    }
  });

  it("an unknown @-target is unavailable (never treated as a profileDirectory)", async () => {
    const s = setup({ config: { onUnavailable: "stop" } });
    const r = await resolveBrowserConnect({ target: "@panerelay" }, s.deps);
    expect(r).toMatchObject({ unavailable: { target: "@panerelay", reason: "unknown-target" }, stopped: true });
    expect(s.connectProfile).not.toHaveBeenCalled();
  });

  it("a thrown connect is a failed attempt, not an exception", async () => {
    const s = setup({ config: { onUnavailable: "stop" } });
    s.connectDedicated.mockRejectedValueOnce(new Error("spawn failed"));
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toMatchObject({ stopped: true, unavailable: { target: "@dedicated", reason: "error:spawn failed" } });
  });
});

describe("#E19 policies (dedicated busy)", () => {
  const busy = { available: true, instanceId: "ded-1", holder: "OTHER" };

  it("ask (default) → unavailable + options, nothing connected", async () => {
    const s = setup({ dedicated: busy, config: { realProfile: "P" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toEqual({
      unavailable: { target: "@dedicated", reason: "busy" },
      options: [
        { target: "@dedicated", label: "Dedicated browser", available: false, reason: "busy" },
        { target: "P", label: "Work", available: true },
        { target: "@headless", label: "Headless browser", available: true },
      ],
      attempts: [{ target: "@dedicated", ok: false, reason: "busy" }],
    });
    expect(s.calls).toEqual([]);
  });

  it("stop → unavailable + stopped:true, no connect performed", async () => {
    const s = setup({ dedicated: busy, config: { onUnavailable: "stop", realProfile: "P" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toEqual({
      unavailable: { target: "@dedicated", reason: "busy" },
      stopped: true,
      attempts: [{ target: "@dedicated", ok: false, reason: "busy" }],
    });
    expect(s.calls).toEqual([]);
  });

  it("next → falls through the chain (profile connects)", async () => {
    const s = setup({ dedicated: busy, config: { onUnavailable: "next", realProfile: "P" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toMatchObject({ browser: "profile", profileDirectory: "P" });
    expect(s.connectDedicated).not.toHaveBeenCalled();
  });

  it("ask: options carry unavailable reasons for uninstalled / unavailable candidates; unset realProfile is omitted", async () => {
    const s = setup({ dedicated: { available: false, reason: "no-chrome" }, config: { realProfile: "Q" } });
    const r = (await resolveBrowserConnect({}, s.deps)) as { options: unknown[] };
    expect(r.options).toEqual([
      { target: "@dedicated", label: "Dedicated browser", available: false, reason: "no-chrome" },
      { target: "Q", label: "Other", available: false, reason: "not-installed" },
      { target: "@headless", label: "Headless browser", available: true },
    ]);
    const s2 = setup({ dedicated: { available: false, reason: "no-chrome" } });
    const r2 = (await resolveBrowserConnect({}, s2.deps)) as { options: Array<{ target: string }> };
    expect(r2.options.map((o) => o.target)).toEqual(["@dedicated", "@headless"]);
  });

  it("a connect-time race (busy reply) is handled like a pre-check busy", async () => {
    const s = setup({ dedicatedConnect: { ok: false, reason: "busy", status: 409 } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toMatchObject({ unavailable: { target: "@dedicated", reason: "busy" } });
    expect(s.connectDedicated).toHaveBeenCalledTimes(1);
  });

  it("an explicit profile target that fails asks with that target first", async () => {
    const s = setup({ profileConnect: { ok: false, reason: "not-installed", status: 409 } });
    const r = (await resolveBrowserConnect({ target: "P" }, s.deps)) as { unavailable: unknown; options: Array<{ target: string }> };
    expect(r.unavailable).toEqual({ target: "P", reason: "not-installed" });
    expect(r.options.map((o) => o.target)).toEqual(["P", "@dedicated", "@headless"]);
  });
});

describe("connected results and live view", () => {
  it("dedicated connect records the calling session as holder and live view", async () => {
    const s = setup();
    const r = await resolveBrowserConnect({}, s.deps);
    expect(s.connectDedicated).toHaveBeenCalledWith({ holder: "S" });
    expect(r).toEqual({
      browser: "dedicated",
      instanceId: "ded-2",
      cdpUrl: "ws://d/1",
      liveView: true,
      attempts: [{ target: "@dedicated", ok: true }],
    });
    expect(s.remember).toHaveBeenCalledWith("ded-2", "S");
  });

  it("openLiveViewOnConnect:false → liveView false, session not remembered", async () => {
    const s = setup({ config: { openLiveViewOnConnect: false } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toMatchObject({ liveView: false });
    expect(s.remember).not.toHaveBeenCalled();
  });

  it("profile connect also remembers the session", async () => {
    const s = setup({ config: { defaultBrowser: "P" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toMatchObject({ browser: "profile", profileDirectory: "P", liveView: true });
    expect(s.remember).toHaveBeenCalledWith("prof-1", "S");
  });

  it("a hostile target argument is ignored, not routed", async () => {
    const s = setup();
    const r = await resolveBrowserConnect({ target: 42 as never }, s.deps);
    expect(targets(r as never)).toEqual(["@dedicated"]);
  });
});

describe("#R14 same-session reconnect", () => {
  const held = (holder: string) => ({ available: true, instanceId: "ded-1", holder });

  it("holder === caller → I1 closed first, then a new instance connects with a new cdpUrl", async () => {
    const s = setup({ dedicated: held("S") });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(s.calls).toEqual(["disconnect", "connectDedicated"]);
    expect(s.disconnect).toHaveBeenCalledWith("ded-1");
    expect(r).toMatchObject({ browser: "dedicated", instanceId: "ded-2", cdpUrl: "ws://d/1" });
  });

  it("another session calling would get busy (nothing closed)", async () => {
    const s = setup({ dedicated: held("S") });
    const r = await resolveBrowserConnect({}, { ...s.deps, sessionId: "T" });
    expect(r).toMatchObject({ unavailable: { target: "@dedicated", reason: "busy" } });
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it("a live instance with no recorded holder is busy for everyone", async () => {
    const s = setup({ dedicated: { available: true, instanceId: "ded-1" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(r).toMatchObject({ unavailable: { reason: "busy" } });
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it("never routes to Panerelay: no target/option mentions it", async () => {
    const s = setup({ dedicated: { available: false, reason: "x" } });
    const r = await resolveBrowserConnect({}, s.deps);
    expect(JSON.stringify(r).toLowerCase()).not.toContain("panerelay");
  });
});
