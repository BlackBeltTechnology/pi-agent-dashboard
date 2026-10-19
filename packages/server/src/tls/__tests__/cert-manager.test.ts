import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CertFiles } from "../cert-files.js";
import { CertManager } from "../cert-manager.js";
import { TlsCertStore } from "../cert-store.js";
import { RetryAfterError } from "../types.js";
import { FakeSource, fixture, flush } from "./helpers.js";

/**
 * CertManager lifecycle (test-plan #E7–#E14, #E17, #E39–#E41, #E43, #E46–#E48, #E51, #E15, #E9–#E11).
 * See change: add-tailscale-cert-tls.
 */

const MIN = 60_000;
let root: string;
let files: CertFiles;
let store: TlsCertStore;
let mgr: CertManager;
const quiet = { info: () => undefined, warn: vi.fn() };

function makeManager(): CertManager {
  return new CertManager({ files, store, log: quiet });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date());
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tls-mgr-"));
  files = new CertFiles(root);
  store = new TlsCertStore();
  quiet.warn.mockClear();
  mgr = makeManager();
});

afterEach(() => {
  mgr.suspend();
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("renewal (#E7)", () => {
  it("obtains only when less than 1/3 of the validity remains (BVA)", async () => {
    const src = new FakeSource({ names: ["host.example.ts.net"] });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(src.obtainCalls).toHaveLength(1);

    const x = new X509Certificate(fixture("host.example.ts.net").certPem);
    const nb = Date.parse(x.validFrom);
    const na = Date.parse(x.validTo);
    const third = (na - nb) / 3;

    vi.setSystemTime(na - third - 30 * 24 * 60 * MIN); // 30 days of margin before the window: not due
    await mgr.tick();
    await mgr.settle();
    expect(src.obtainCalls).toHaveLength(1);

    vi.setSystemTime(na - third + 60 * MIN); // inside the window
    await mgr.tick();
    await mgr.settle();
    expect(src.obtainCalls).toHaveLength(2);
  });
});

describe("fingerprint re-issue (#E9)", () => {
  it("re-obtains only the name whose fingerprint changed", async () => {
    const src = new FakeSource({ names: ["a.test", "b.test"], fingerprint: (n) => `f1-${n}` });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(src.obtainCalls.sort()).toEqual(["a.test", "b.test"]);

    src.obtainCalls = [];
    src.fingerprint = (n) => (n === "a.test" ? "f2-a" : `f1-${n}`);
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(src.obtainCalls).toEqual(["a.test"]);
  });

  it("a list source gaining a name only obtains the new one", async () => {
    const src = new FakeSource({ names: ["a.test", "b.test"], fingerprint: (n) => `fp-${n}` });
    await mgr.reconcile([src]);
    await mgr.settle();
    src.obtainCalls = [];
    src.namesValue = ["a.test", "b.test", "c.test"];
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(src.obtainCalls).toEqual(["c.test"]);
  });
});

describe("prune (#E10, #E40)", () => {
  it("drops a name the source no longer lists: handshake map, files, status", async () => {
    const src = new FakeSource({ names: ["a.test", "b.test"] });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(store.resolve("b.test")).not.toBeNull();
    expect(fs.existsSync(files.nameDir("fake", "b.test"))).toBe(true);

    src.namesValue = ["a.test"];
    await mgr.reconcile([src]);
    expect(store.resolve("b.test")).toBeNull();
    expect(fs.existsSync(files.nameDir("fake", "b.test"))).toBe(false);
    expect(mgr.advertisable().map((e) => e.name)).toEqual(["a.test"]);
    expect(store.resolve("a.test")).not.toBeNull();
  });

  it("names() === null keeps every held name serving and its files", async () => {
    const src = new FakeSource({ names: ["host.example.ts.net"] });
    await mgr.reconcile([src]);
    await mgr.settle();
    src.namesValue = null;
    await mgr.reconcile([src]);
    expect(store.resolve("host.example.ts.net")).not.toBeNull();
    expect(fs.existsSync(files.nameDir("fake", "host.example.ts.net"))).toBe(true);
    expect(mgr.status().certs.map((c) => c.name)).toContain("host.example.ts.net");
  });
});

describe("name conflict + overlap (#E11, #E43)", () => {
  it("only the first source issues an identical name; the second reports name-conflict", async () => {
    const s1 = new FakeSource({ id: "s1", names: ["x.test"] });
    const s2 = new FakeSource({ id: "s2", names: ["x.test"] });
    await mgr.reconcile([s1, s2]);
    await mgr.settle();
    expect(s1.obtainCalls).toEqual(["x.test"]);
    expect(s2.obtainCalls).toEqual([]);
    expect(mgr.status().gates).toContainEqual(expect.objectContaining({ id: "name-conflict", name: "x.test", ok: false, sourceId: "s2" }));
  });

  it("an exact name and a wildcard covering it do not conflict; exact wins at selection", async () => {
    const s1 = new FakeSource({ id: "s1", names: ["dash.example.com"] });
    const s2 = new FakeSource({ id: "s2", names: ["*.example.com"] });
    await mgr.reconcile([s1, s2]);
    await mgr.settle();
    expect(s1.obtainCalls).toEqual(["dash.example.com"]);
    expect(s2.obtainCalls).toEqual(["*.example.com"]);
    expect(mgr.status().gates.filter((g) => g.id === "name-conflict")).toEqual([]);
    expect(store.resolve("dash.example.com")?.sourceId).toBe("s1");
    expect(store.resolve("x.example.com")?.name).toBe("*.example.com");
  });
});

describe("single-flight (#E12)", () => {
  it("a trigger joins the running attempt; both awaiters get the same outcome", async () => {
    const src = new FakeSource({ names: ["x.test"] });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    src.obtainImpl = async () => {
      await gate;
      return { ...fixture("x.test"), advertise: true, kind: "magicdns" };
    };
    await mgr.reconcile([src]);
    await flush();
    expect(src.obtainCalls).toHaveLength(1);
    const joined = mgr.trigger("fake", "x.test");
    await flush();
    expect(src.obtainCalls).toHaveLength(1);
    release();
    const outcome = await joined;
    expect(outcome).toEqual([{ ok: true }]);
    await mgr.settle();
    expect(src.obtainCalls).toHaveLength(1);
  });
});

describe("backoff (#E13, #E14, #E41)", () => {
  it("attempt gaps double from 5 min and cap at 6 h", async () => {
    const src = new FakeSource({ names: ["x.test"] });
    const starts: number[] = [];
    src.obtainImpl = async () => {
      starts.push(Date.now());
      throw new Error("boom");
    };
    await mgr.reconcile([src]);
    await mgr.settle();
    // Step in 1-minute increments so each attempt start is observed at its own boundary.
    for (let i = 0; i < 1900; i++) {
      await vi.advanceTimersByTimeAsync(MIN);
      await mgr.settle();
    }
    const gaps = starts.slice(1).map((t, i) => Math.round((t - starts[i]!) / MIN));
    expect(gaps.slice(0, 9)).toEqual([5, 10, 20, 40, 80, 160, 320, 360, 360]);
  });

  it("a source-imposed retry floor is honoured (59 min no, 60 min yes)", async () => {
    const src = new FakeSource({ names: ["x.test"] });
    let calls = 0;
    src.obtainImpl = async () => {
      calls += 1;
      throw new RetryAfterError("rate limited", 60 * MIN);
    };
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(59 * MIN);
    await mgr.settle();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1 * MIN);
    await mgr.settle();
    expect(calls).toBe(2);
  });

  it("persisted backoff survives a restart (new manager, same files)", async () => {
    const src = new FakeSource({ names: ["x.test"] });
    src.obtainImpl = async () => {
      throw new Error("boom");
    };
    await mgr.reconcile([src]);
    await mgr.settle();
    // Fast-forward through 3 more failures (5+10+20 min) so failures=4, next in 40 min.
    for (const wait of [5, 10, 20]) {
      await vi.advanceTimersByTimeAsync(wait * MIN);
      await mgr.settle();
    }
    const meta = await files.readMeta("fake", "x.test");
    expect(meta?.failures).toBe(4);
    const due = meta?.nextAttemptAt as number;
    expect(due - Date.now()).toBe(40 * MIN);
    mgr.suspend();

    const src2 = new FakeSource({ names: ["x.test"] });
    mgr = makeManager();
    await mgr.reconcile([src2]);
    await mgr.settle();
    expect(src2.obtainCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(39 * MIN);
    await mgr.settle();
    expect(src2.obtainCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1 * MIN);
    await mgr.settle();
    expect(src2.obtainCalls).toEqual(["x.test"]);
  });
});

describe("source removal (#E17)", () => {
  it("deletes the source's files once and calls onRemoved once", async () => {
    const s1 = new FakeSource({ id: "s1", names: ["a.test"] });
    await mgr.reconcile([s1]);
    await mgr.settle();
    expect(fs.existsSync(path.join(root, "s1"))).toBe(true);
    await mgr.reconcile([]);
    expect(fs.existsSync(path.join(root, "s1"))).toBe(false);
    expect(s1.removed).toBe(1);
    expect(store.resolve("a.test")).toBeNull();
  });
});

describe("key storage (#E15)", () => {
  it("writes the key 0600 and never leaves tmp files", async () => {
    const src = new FakeSource({ names: ["a.test"] });
    await mgr.reconcile([src]);
    await mgr.settle();
    const dir = files.nameDir("fake", "a.test");
    const mode = fs.statSync(path.join(dir, "key.pem")).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readdirSync(dir).sort()).toEqual(["cert.pem", "key.pem", "meta.json"]);
  });
});

describe("mismatched stored pair (#E39)", () => {
  it("is not served, warns, and is re-obtained once", async () => {
    const dir = files.nameDir("fake", "a.test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "cert.pem"), fixture("a.test").certPem);
    fs.writeFileSync(path.join(dir, "key.pem"), fixture("b.test").keyPem);
    const src = new FakeSource({ names: ["a.test"] });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringContaining("do not match"));
    expect(src.obtainCalls).toEqual(["a.test"]);
    expect(store.resolve("a.test")).not.toBeNull(); // the re-obtained pair
  });
});

describe("gate before obtain (#E46)", () => {
  it("an unmet source-wide gate prevents the attempt without counting a failure", async () => {
    const src = new FakeSource({ names: ["a.test"], gates: [{ id: "x", ok: false }] });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(src.obtainCalls).toEqual([]);
    expect(mgr.status().certs[0]).toMatchObject({ name: "a.test", held: false, stage: "idle" });
    expect((await files.readMeta("fake", "a.test"))?.failures ?? 0).toBe(0);
    // re-checked after 15 min, forcing readiness
    src.readinessCalls = [];
    src.gates = [];
    await vi.advanceTimersByTimeAsync(15 * MIN);
    await mgr.settle();
    expect(src.readinessCalls.some((c) => c.force)).toBe(true);
    expect(src.obtainCalls).toEqual(["a.test"]);
  });

  it("a name-scoped gate blocks only that name", async () => {
    const src = new FakeSource({ names: ["a.test", "b.test"], gates: [{ id: "x", ok: false, name: "a.test" }] });
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(src.obtainCalls).toEqual(["b.test"]);
    await mgr.trigger("fake", "a.test");
    expect(src.obtainCalls).toEqual(["b.test"]);
  });

  it("reconcile forces readiness then calls onReconciled once", async () => {
    const src = new FakeSource({ names: ["a.test"] });
    await mgr.reconcile([src]);
    expect(src.readinessCalls[0]).toEqual({ force: true });
    expect(src.reconciled).toBe(1);
  });
});

describe("attempt deadline (#E47)", () => {
  it("abandons a hung attempt, starts a new one on trigger and discards the late result", async () => {
    const src = new FakeSource({ names: ["a.test"], attemptTimeoutMs: 1000 });
    const lateResolvers: Array<() => void> = [];
    src.obtainImpl = (name) =>
      new Promise((resolve) => {
        lateResolvers.push(() => resolve({ ...fixture("a.test"), advertise: true, kind: "magicdns" }));
        void name;
      });
    await mgr.reconcile([src]);
    await flush();
    expect(src.obtainCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(mgr.status().certs[0]?.lastError).toBe("timed out");

    void mgr.trigger("fake", "a.test");
    await flush(20);
    expect(src.obtainCalls).toHaveLength(2); // a new attempt, not a join

    lateResolvers[0]?.(); // the abandoned first attempt returns late
    await flush(20);
    expect(store.resolve("a.test")).toBeNull();
    expect(fs.existsSync(path.join(files.nameDir("fake", "a.test"), "cert.pem"))).toBe(false);
  });
});

describe("invalid sources + empty (#E48)", () => {
  it("reports invalid-source gates while valid sources keep running", async () => {
    const src = new FakeSource({ names: ["a.test"] });
    await mgr.reconcile([src], [{ index: 0, message: "unknown type foo" }]);
    await mgr.settle();
    expect(src.obtainCalls).toEqual(["a.test"]);
    expect(mgr.status().gates).toContainEqual(
      expect.objectContaining({ id: "invalid-source", ok: false, hint: expect.stringContaining("tls.sources[0]") }),
    );
  });

  it("no sources → no-sources gate", async () => {
    await mgr.reconcile([]);
    expect(mgr.status().gates).toContainEqual(expect.objectContaining({ id: "no-sources", ok: false }));
  });
});

describe("status lists waiting names (#E51)", () => {
  it("a gated name appears without notAfter, stage idle", async () => {
    const src = new FakeSource({ names: ["a.test", "b.test"], gates: [{ id: "x", ok: false, name: "b.test" }] });
    await mgr.reconcile([src]);
    await mgr.settle();
    const rows = Object.fromEntries(mgr.status().certs.map((c) => [c.name, c]));
    expect(rows["a.test"]?.notAfter).toBeTypeOf("number");
    expect(rows["b.test"]).toMatchObject({ held: false, stage: "idle" });
    expect(rows["b.test"]?.notAfter).toBeUndefined();
  });
});

describe("status retry time + details (#E34)", () => {
  it("exposes nextAttemptAt = failure + 5 min and source details", async () => {
    const src = new FakeSource({ names: ["a.test"], details: { ipv4: "100.83.0.1" } });
    src.obtainImpl = async () => {
      throw new Error("nope");
    };
    const t0 = Date.now();
    await mgr.reconcile([src]);
    await mgr.settle();
    const status = mgr.status();
    expect(status.certs[0]?.nextAttemptAt).toBe(t0 + 5 * MIN);
    expect(status.sources[0]).toMatchObject({ id: "fake", details: { ipv4: "100.83.0.1" } });
    const calls = src.readinessCalls.length;
    mgr.status();
    expect(src.readinessCalls.length).toBe(calls); // status never calls out
  });
});

describe("lastError truncation", () => {
  it("is cut to 500 chars", async () => {
    const src = new FakeSource({ names: ["a.test"] });
    src.obtainImpl = async () => {
      throw new Error("e".repeat(501));
    };
    await mgr.reconcile([src]);
    await mgr.settle();
    expect(mgr.status().certs[0]?.lastError).toHaveLength(500);
  });
});
