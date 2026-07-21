/**
 * zrok v2 provider tests — folded from test-plan.md (support-zrok-v2).
 *
 * Covers: binary resolution (E1/E2/E3), buildArgs (E4/E5), URL regex anchor
 * (E13/E14/E15), share-failure + timeout + scavenge (X1/X2/X3), reserved-name
 * retry-no-recycle (X4), ephemeral no-auto-mint (X5), legacy-token-ignored
 * (X6), and name-taken fallback (X10).
 *
 * Modeled on `tunnel-ngrok.test.ts` (fake child + spawn/exec mocks).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.kill = vi.fn();
  return child;
}

const spawnMock = vi.fn();
const execSyncMock = vi.fn();
const execFileSyncMock = vi.fn();
const whichMock = vi.fn();

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    spawn: (...a: any[]) => spawnMock(...a),
    execSync: (...a: any[]) => execSyncMock(...a),
    execFileSync: (...a: any[]) => execFileSyncMock(...a),
  };
});

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ToolResolver: class {
      which(name: string) {
        return whichMock(name);
      }
    },
  };
});

// Avoid touching the real config file when a reserved name is persisted.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const def = { ...(actual.default ?? actual), existsSync: vi.fn(() => false), readFileSync: vi.fn(() => "{}"), writeFileSync: vi.fn() };
  return { ...actual, default: def, ...def };
});

import {
  _resetBinaryCache,
  detectZrokBinary,
  ensureReservedName,
  mintReservedName,
  ZrokProvider,
  zrokChildSpec,
  zrokRuntime,
} from "../tunnel-providers/zrok.js";

beforeEach(() => {
  spawnMock.mockReset();
  execSyncMock.mockReset();
  execFileSyncMock.mockReset();
  whichMock.mockReset();
  _resetBinaryCache();
  vi.spyOn(zrokChildSpec, "isEnrolled").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

// ── E1/E2/E3 binary resolution ──────────────────────────────────────
describe("zrok binary resolution (E1/E2/E3)", () => {
  it("E1: resolver finds only zrok2 → chosen binary is zrok2", () => {
    whichMock.mockImplementation((n: string) => (n === "zrok2" ? "/opt/bin/zrok2" : null));
    expect(detectZrokBinary()).toBe(true);
    expect(zrokChildSpec.getBinary()).toBe("/opt/bin/zrok2");
  });

  it("E2: resolver finds only zrok (Homebrew) → chosen binary is zrok", () => {
    whichMock.mockImplementation((n: string) => (n === "zrok" ? "/opt/homebrew/bin/zrok" : null));
    expect(detectZrokBinary()).toBe(true);
    expect(zrokChildSpec.getBinary()).toBe("/opt/homebrew/bin/zrok");
  });

  it("E2b: prefers zrok2 when BOTH resolve", () => {
    whichMock.mockImplementation((n: string) => (n === "zrok2" ? "/a/zrok2" : "/a/zrok"));
    expect(zrokChildSpec.getBinary()).toBe("/a/zrok2");
  });

  it("E3: neither resolves → detectBinary false", () => {
    whichMock.mockReturnValue(null);
    expect(detectZrokBinary()).toBe(false);
  });
});

// ── E4/E5 buildArgs (flags-first, target-last) ──────────────────────
describe("zrok buildArgs (E4/E5)", () => {
  it("E4: ephemeral (no name) → share public --headless localhost:<port>", () => {
    expect(zrokChildSpec.buildArgs(8000, undefined)).toEqual([
      "share",
      "public",
      "--headless",
      "localhost:8000",
    ]);
  });

  it("E5: reserved name → share public --headless -n public:<name> localhost:<port>", () => {
    expect(zrokChildSpec.buildArgs(8000, "myapp")).toEqual([
      "share",
      "public",
      "--headless",
      "-n",
      "public:myapp",
      "localhost:8000",
    ]);
  });
});

// ── E13/E14/E15 URL regex + normalize (anchored host) ───────────────
describe("zrok urlRegex + normalizeUrl (E13/E14/E15)", () => {
  const match = (s: string) => s.match(zrokChildSpec.urlRegex)?.[0];
  const norm = (s: string) => zrokChildSpec.normalizeUrl!(s);

  it("E13: bare v2 host matches and normalizes to https://", () => {
    const m = match("share created: abc.shares.zrok.io\n");
    expect(m).toBe("abc.shares.zrok.io");
    expect(norm(m!)).toBe("https://abc.shares.zrok.io");
  });

  it("E14: schemed v1 singular host matches and stays unchanged", () => {
    const m = match("https://abc.share.zrok.io");
    expect(m).toBe("https://abc.share.zrok.io");
    expect(norm(m!)).toBe("https://abc.share.zrok.io");
  });

  it("E15: spoofed *.shares.zrok.io.attacker.com is NOT matched as a zrok host", () => {
    // The anchored host regex MUST NOT match at all — a partial match whose
    // host is the attacker domain is exactly the regression this rejects.
    expect("foo.shares.zrok.io.attacker.com/x".match(zrokChildSpec.urlRegex)).toBeNull();
  });
});

// ── X1 share creation fails (ephemeral) ─────────────────────────────
describe("zrok createTunnel error handling (X1/X2/X4)", () => {
  it("X1: share exits non-zero before a URL → null, no throw", async () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const p = zrokRuntime.createTunnel(8000);
    setTimeout(() => child.emit("exit", 1), 0);
    await expect(p).resolves.toBeNull();
    // never released anything (ephemeral, no token)
    expect(execFileSyncMock).not.toHaveBeenCalled();
    await zrokRuntime.deleteTunnel(8000);
  });

  it("X2: no URL within the spawn timeout → killed, null", async () => {
    vi.useFakeTimers();
    whichMock.mockReturnValue("/opt/bin/zrok2");
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const p = zrokRuntime.createTunnel(8000);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBeNull();
    vi.useRealTimers();
    await zrokRuntime.deleteTunnel(8000);
  });

  it("X4: reserved name, share exits once → SAME name re-served, no delete name", async () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    const c1 = fakeChild();
    const c2 = fakeChild();
    spawnMock.mockReturnValueOnce(c1).mockReturnValueOnce(c2);
    const p = zrokRuntime.createTunnel(8000, "myname");
    setTimeout(() => c1.emit("exit", 1), 0);
    setTimeout(() => c2.stdout.emit("data", Buffer.from("myname.shares.zrok.io\n")), 10);
    const url = await p;
    expect(url).toBe("https://myname.shares.zrok.io");
    // never released the caller-provided reserved name
    expect(execFileSyncMock).not.toHaveBeenCalledWith(
      expect.anything(),
      ["delete", "name", "myname"],
      expect.anything(),
    );
    // both spawns served the SAME reserved name
    expect(spawnMock.mock.calls[0][1]).toContain("public:myname");
    expect(spawnMock.mock.calls[1][1]).toContain("public:myname");
    await zrokRuntime.deleteTunnel(8000);
  });
});

// ── X3 scavenge matches zrok2 (regex marker) ────────────────────────
describe("zrok scavengeOrphans matches zrok2 (X3)", () => {
  it("matches the real flags-first zrok2 share line; skips a bare port line; matches v1 zrok share", () => {
    execSyncMock.mockReturnValue(
      Buffer.from(
        [
          "12345 /usr/local/bin/zrok2 share public --headless -n public:x localhost:8000",
          "12346 zrok share public --headless localhost:8000",
          "12347 some-daemon --bind localhost:8000",
          "12348 /usr/local/bin/zrok2 share public --headless localhost:9000",
        ].join("\n"),
      ),
    );
    vi.spyOn(process, "kill").mockReturnValue(true);
    const killed = zrokRuntime.scavengeOrphans(8000);
    expect(killed).toContain(12345); // zrok2 share on :8000
    expect(killed).toContain(12346); // v1 zrok share on :8000
    expect(killed).not.toContain(12347); // bare localhost:8000, not a zrok share
    expect(killed).not.toContain(12348); // zrok2 share but wrong port
  });
});

// ── X5/X6 connect: no auto-mint, legacy token ignored ───────────────
describe("ZrokProvider.connect (X5/X6)", () => {
  it("X5: persistent=false → never calls `create name`; ephemeral share only", async () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const provider = new ZrokProvider();
    const p = provider.connect(8000, "public", { persistent: false });
    setTimeout(() => child.stdout.emit("data", Buffer.from("eph1.shares.zrok.io\n")), 0);
    const res = await p;
    expect(res.endpoints[0]?.url).toBe("https://eph1.shares.zrok.io");
    // no `create name` minted
    expect(execFileSyncMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["create", "name"]),
      expect.anything(),
    );
    // ephemeral args carry no -n public:
    expect(spawnMock.mock.calls[0][1]).not.toContain("-n");
    await zrokRuntime.deleteTunnel(8000);
  });

  it("X6: stray legacy reservedToken, no reservedName → ephemeral, NOT -n public:<v1tok>", async () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const provider = new ZrokProvider();
    const p = provider.connect(8000, "public", { reservedToken: "v1tok" } as any);
    setTimeout(() => child.stdout.emit("data", Buffer.from("eph2.shares.zrok.io\n")), 0);
    await p;
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).not.toContain("public:v1tok");
    expect(args).not.toContain("-n");
    await zrokRuntime.deleteTunnel(8000);
  });
});

// ── X10 name minting: taken-by-other falls back to ephemeral ────────
describe("mintReservedName (X10)", () => {
  it("success → returns a pi-dash-<hex> name", () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    execFileSyncMock.mockReturnValue(Buffer.from(""));
    const name = mintReservedName();
    expect(name).toMatch(/^pi-dash-[0-9a-f]{8}$/);
  });

  it("already-exists-for-this-account → reuses the name", () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("name already exists"), { stderr: "name already exists" });
    });
    expect(mintReservedName("keepme")).toBe("keepme");
  });

  it("taken-by-another-account → null (ephemeral fallback), no persist", () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error("name reserved by another account"), {
        stderr: "name reserved by another account",
      });
    });
    vi.mocked(fs.writeFileSync).mockClear();
    expect(mintReservedName()).toBeNull();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("generic failure → null", () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    execFileSyncMock.mockImplementation(() => {
      throw new Error("network unreachable");
    });
    expect(mintReservedName()).toBeNull();
  });
});

// ── ensureReservedName routing (X5/X6 support) ──────────────────────
describe("ensureReservedName", () => {
  it("serves a stored name ONLY when persistent (no mint)", () => {
    execFileSyncMock.mockReturnValue(Buffer.from(""));
    expect(ensureReservedName({ reservedName: "stored", persistent: true })).toBe("stored");
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("stays ephemeral for a stored name when persistence is off", () => {
    expect(ensureReservedName({ reservedName: "stored", persistent: false })).toBeUndefined();
    expect(ensureReservedName({ persistent: false })).toBeUndefined();
    expect(ensureReservedName(undefined)).toBeUndefined();
  });

  it("rejects a non-DNS-safe stored name (stays ephemeral)", () => {
    expect(ensureReservedName({ reservedName: "-oops --flag", persistent: true })).toBeUndefined();
  });

  it("mints when persistent and no stored name", () => {
    whichMock.mockReturnValue("/opt/bin/zrok2");
    execFileSyncMock.mockReturnValue(Buffer.from(""));
    expect(ensureReservedName({ persistent: true })).toMatch(/^pi-dash-[0-9a-f]{8}$/);
  });
});
