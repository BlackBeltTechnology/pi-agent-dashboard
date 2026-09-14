/**
 * RelayManager (change: add-browser-relay) — test-plan #E9 (guid validity BVA),
 * #E19 (409 reasons), #E20 (disconnect param), #E21 (kill switch), #X1 (connect
 * timeout), #X10 (systemOpen unavailable), #E28 (fake instance gating).
 *
 * The manager is driven with injectable seams, so the whole connect lifecycle is
 * exercised without Chrome: `openChrome` receives the connect URL (which carries
 * the guid) and stands in for the extension dialling back in.
 */
import { describe, expect, it } from "vitest";
import { AuditRing } from "../audit.js";
import { FakeExtension, flush, socketPair } from "../relay/__tests__/fake-socket.js";
import { isValidGuid, type RelayConfig, RelayManager } from "../relay/relay-manager.js";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface HarnessOpts {
  config?: RelayConfig;
  installed?: boolean;
  canOpenChrome?: boolean;
  port?: number;
  connectTimeoutMs?: number;
  guidExpiryMs?: number;
  /** Recording logger for the observability assertions (2.11). */
  logger?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  /** Override profile discovery (kill-switch-race test gates it). */
  listProfiles?: () => Promise<{ profiles: Array<{ profileDirectory: string; label: string; installed: boolean }> }>;
  /** Complete the extension handshake as soon as Chrome is "opened". */
  dialOnOpen?: boolean;
}

interface Harness {
  manager: RelayManager;
  audit: AuditRing;
  /** The connect URL(s) the opener received — the only place the guid is readable. */
  urls: string[];
  config: RelayConfig;
  /** The guid carried by the connect URL at `index`. */
  guidAt(index: number): string;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const audit = new AuditRing();
  const urls: string[] = [];
  const config: RelayConfig = opts.config ?? { enabled: true, browsers: { Default: {} } };
  const harness: Harness = {
    manager: undefined as unknown as RelayManager,
    audit,
    urls,
    config,
    guidAt: (index) =>
      new URL(urls[index]).searchParams.get("mcpRelayUrl")!.split("/").pop()!,
  };

  harness.manager = new RelayManager({
    audit,
    logger: opts.logger ?? silentLogger,
    getConfig: () => config,
    getPort: () => opts.port ?? 8000,
    canOpenChrome: () => opts.canOpenChrome ?? true,
    listProfiles: opts.listProfiles
      ? opts.listProfiles
      : async () => ({
          profiles: [
            { profileDirectory: "Default", label: "Default", installed: opts.installed ?? true },
          ],
        }),
    openChrome: (_profile, url) => {
      urls.push(url);
      if (!opts.dialOnOpen) return;
      // The extension dials back with the guid carried in the connect URL —
      // exactly what the real Chrome extension does.
      const guid = new URL(url).searchParams.get("mcpRelayUrl")!.split("/").pop()!;
      const [relayExt, extSide] = socketPair();
      harness.manager.attachExtension(guid, relayExt);
      new FakeExtension(extSide, [{ id: 7, title: "A", url: "https://a.test/" }]).initialize();
    },
    onStatusChange: () => {},
    connectTimeoutMs: opts.connectTimeoutMs,
    guidExpiryMs: opts.guidExpiryMs,
  });
  return harness;
}

/** A harness whose extension completes the handshake immediately. */
function connectedHarness(opts: HarnessOpts = {}): Harness {
  return makeHarness({ ...opts, dialOnOpen: true });
}

describe("guid validation (E9)", () => {
  it("accepts only 32 lowercase hex chars", () => {
    expect(isValidGuid("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isValidGuid("abc")).toBe(false);
    expect(isValidGuid("0123456789abcdef0123456789abcde")).toBe(false); // 31
    expect(isValidGuid("0123456789abcdef0123456789abcdef0")).toBe(false); // 33
    expect(isValidGuid("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(isValidGuid("../etc/passwd")).toBe(false);
  });

  it("resolve() returns undefined for never-minted and malformed guids", () => {
    const { manager } = connectedHarness();
    expect(manager.resolve("0123456789abcdef0123456789abcdef")).toBeUndefined();
    expect(manager.resolve("abc")).toBeUndefined();
  });
});

describe("connect lifecycle", () => {
  it("returns a loopback cdpUrl on the dashboard port once the extension dials (spec)", async () => {
    const h = connectedHarness({ port: 8123 });
    const result = await h.manager.connect("Default");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const guid = h.guidAt(0);
    expect(result.cdpUrl).toBe(`ws://127.0.0.1:8123/ws/browser-cdp/${guid}`);
    expect(result.instanceId).toMatch(/^inst-/);
    // instanceId must not be the guid, or the status broadcast would leak the credential.
    expect(result.instanceId).not.toContain(guid);
  });

  it("logs the instance-open and connect-latency lines (2.11)", async () => {
    const lines: string[] = [];
    const logger = {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    };
    const { manager } = connectedHarness({ logger });
    expect((await manager.connect("Default")).ok).toBe(true);
    expect(lines.some((l) => l === "[browser-relay] instance Default open (connect)")).toBe(true);
    expect(lines.some((l) => /^\[browser-relay\] instance Default connected in \d+ms$/.test(l))).toBe(true);
  });

  it("409 {reason:'not-installed'} when the extension is absent from the profile (E19)", async () => {
    const { manager, urls } = connectedHarness({ installed: false });
    const result = await manager.connect("Default");
    expect(result).toEqual({ ok: false, status: 409, reason: "not-installed" });
    expect(urls).toHaveLength(0); // never opened Chrome
  });

  it("409 {reason:'busy', instanceId} on a second connect, leaving the first untouched (E19)", async () => {
    const { manager } = connectedHarness();
    const first = await manager.connect("Default");
    expect(first.ok).toBe(true);
    const second = await manager.connect("Default");
    expect(second).toEqual({
      ok: false,
      status: 409,
      reason: "busy",
      instanceId: first.ok ? first.instanceId : undefined,
    });
    expect(manager.instances("Default")).toHaveLength(1);
  });

  it("allows two instances on one profile when configured (task 2.2b both-paths decision)", async () => {
    const { manager } = connectedHarness({
      config: { enabled: true, allowMultipleInstancesPerProfile: true, browsers: { Default: {} } },
    });
    expect((await manager.connect("Default")).ok).toBe(true);
    expect((await manager.connect("Default")).ok).toBe(true);
    expect(manager.instances("Default")).toHaveLength(2);
  });

  it("403 when the kill switch is off (spec)", async () => {
    const { manager, urls } = connectedHarness({ config: { enabled: false, browsers: {} } });
    expect(await manager.connect("Default")).toEqual({ ok: false, status: 403, reason: "disabled" });
    expect(urls).toHaveLength(0);
  });

  it("503 when the host cannot open Chrome (X10)", async () => {
    const { manager } = connectedHarness({ canOpenChrome: false });
    const result = await manager.connect("Default");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("504 and drops the guid when the extension never dials (X1)", async () => {
    const h = makeHarness({ connectTimeoutMs: 10 });
    expect(await h.manager.connect("Default")).toMatchObject({ ok: false, status: 504 });
    expect(h.manager.resolve(h.guidAt(0))).toBeUndefined();
    expect(h.manager.instances("Default")).toHaveLength(0);
  });

  it("expires an unclaimed guid after the expiry window (E9)", async () => {
    const h = makeHarness({ guidExpiryMs: 10, connectTimeoutMs: 10_000 });
    void h.manager.connect("Default").catch(() => {});
    await flush();
    const guid = h.guidAt(0);
    expect(h.manager.resolve(guid)).toBeDefined();
    await new Promise((r) => setTimeout(r, 30));
    expect(h.manager.resolve(guid)).toBeUndefined();
  });
});

describe("claim + attach", () => {
  it("claims a live guid exactly once (E9 live-unclaimed vs live-claimed)", async () => {
    const h = makeHarness({ connectTimeoutMs: 10_000 });
    void h.manager.connect("Default").catch(() => {});
    await flush();
    const guid = h.guidAt(0);
    expect(h.manager.resolve(guid)?.claimed).toBe(false);
    expect(h.manager.claim(guid)).toBe(true);
    expect(h.manager.claim(guid)).toBe(false);
    expect(h.manager.resolve(guid)?.claimed).toBe(true);
  });

  it("attachExtension on a claimed guid closes the second socket 1000 (E9)", async () => {
    const h = makeHarness({ connectTimeoutMs: 10_000 });
    void h.manager.connect("Default").catch(() => {});
    await flush();
    const guid = h.guidAt(0);

    const [first] = socketPair();
    expect(h.manager.attachExtension(guid, first)).toBe(true);
    const [second] = socketPair();
    expect(h.manager.attachExtension(guid, second)).toBe(true);
    expect(second.closed[0]).toEqual({
      code: 1000,
      reason: "Another extension connection already established",
    });
  });

  it("attachExtension on an unknown guid returns false (404, E9)", () => {
    const { manager } = connectedHarness();
    expect(manager.attachExtension("0123456789abcdef0123456789abcdef", socketPair()[0])).toBe(false);
  });
});

describe("disconnect + kill switch (E20, E21)", () => {
  it("disconnect: unknown instance → false; live instance → closes it (E20)", async () => {
    const { manager } = connectedHarness();
    const result = await manager.connect("Default");
    expect(result.ok).toBe(true);
    expect(manager.disconnect("inst-nope")).toBe(false);
    if (!result.ok) return;
    expect(manager.disconnect(result.instanceId)).toBe(true);
    await flush();
    expect(manager.instances("Default")).toHaveLength(0);
  });

  it("setEnabled(false) closes every instance (E21)", async () => {
    const { manager } = connectedHarness({
      config: { enabled: true, allowMultipleInstancesPerProfile: true, browsers: { Default: {} } },
    });
    await manager.connect("Default");
    await manager.connect("Default");
    expect(manager.instances()).toHaveLength(2);
    await manager.setEnabled(false);
    await flush();
    expect(manager.instances()).toHaveLength(0);
  });

  it("a connect in flight when setEnabled(false) lands does NOT open a tab group (race)", async () => {
    // Gate profile discovery so the disable lands mid-connect — the exact window
    // where the kill switch iterates an empty map and reports success.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const h = makeHarness({
      config: { enabled: true, browsers: { Default: {} } },
      listProfiles: async () => {
        await gate;
        return { profiles: [{ profileDirectory: "Default", label: "Default", installed: true }] };
      },
    });
    const pending = h.manager.connect("Default");
    await h.manager.setEnabled(false);
    release();
    expect(await pending).toEqual({ ok: false, status: 403, reason: "disabled" });
    expect(h.manager.instances()).toHaveLength(0);
  });
});

describe("fake instance gating (E28)", () => {
  it("is never seeded unless asked for", () => {
    const { manager } = connectedHarness();
    expect(manager.instances()).toHaveLength(0);
  });

  it("seeds one Fake instance with tab 1 when enabled", () => {
    const { manager } = connectedHarness({ config: { enabled: true, browsers: {} } });
    const fake = manager.seedFake();
    expect(fake.profileDirectory).toBe("Fake");
    expect(fake.tabList()).toEqual([
      { tabId: 1, title: "Fake tab", url: "https://fake.test/", state: "live" },
    ]);
    expect(manager.instances()).toHaveLength(1);
  });
});
