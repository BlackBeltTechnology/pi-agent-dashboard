/**
 * Unit tests for the lifecycle ownership rule (decideShutdownOnQuit).
 * See change: simplify-electron-bootstrap-derived-state (task 6.9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideShutdownOnQuit, setSpawnedPid, stopServerIfNeeded } from "../server-lifecycle.js";

describe("decideShutdownOnQuit", () => {
  it("starter=Electron, pid match → stop server", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: 1234, storedPid: 1234 })).toBe(true);
  });

  it("starter=Electron, pid mismatch → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: 9999, storedPid: 1234 })).toBe(false);
  });

  it("starter=Bridge → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Bridge", healthPid: 1234, storedPid: 1234 })).toBe(false);
  });

  it("starter=Standalone → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Standalone", healthPid: 1234, storedPid: 1234 })).toBe(false);
  });

  it("storedPid=null → no stop (we never spawned a server)", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: 1234, storedPid: null })).toBe(false);
  });

  it("healthPid undefined → no stop", () => {
    expect(decideShutdownOnQuit({ starter: "Electron", healthPid: undefined, storedPid: 1234 })).toBe(false);
  });

  it("starter undefined → no stop", () => {
    expect(decideShutdownOnQuit({ starter: undefined, healthPid: 1234, storedPid: 1234 })).toBe(false);
  });
});

// ── stopServerIfNeeded: quit-time ownership from the published launchSource ──
// See change: fix-cli-control-electron-server (test-plan #E9, #X9, #P3; design D6/D7).

interface FakeServer {
  fetch: ReturnType<typeof vi.fn>;
  posts: Array<{ url: string; body: unknown }>;
  healthGets: () => number;
}

/** Health answers with `health` until `answerForMs` after the shutdown POST, then refuses. */
function fakeServer(health: Record<string, unknown>, answerForMs: number): FakeServer {
  const posts: Array<{ url: string; body: unknown }> = [];
  let postedAt: number | null = null;
  let gets = 0;
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/shutdown")) {
      posts.push({ url, body: init?.body });
      postedAt ??= Date.now();
      return new Response("{}", { status: 200 });
    }
    gets++;
    if (postedAt !== null && Date.now() >= postedAt + answerForMs) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ ok: true, ...health }), { status: 200 });
  });
  return { fetch: fn, posts, healthGets: () => gets };
}

describe("stopServerIfNeeded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function run(server: FakeServer): Promise<number> {
    vi.stubGlobal("fetch", server.fetch);
    const t0 = Date.now();
    let doneAt = -1;
    const p = stopServerIfNeeded().then(() => {
      doneAt = Date.now() - t0;
    });
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    return doneAt;
  }

  const table: Array<[string, Record<string, unknown>, boolean]> = [
    ["(a) launchSource electron, pid match", { launchSource: "electron", pid: 500 }, true],
    ["(b) legacy starter Electron, pid match", { starter: "Electron", pid: 500 }, true],
    ["(c) electron, pid mismatch", { launchSource: "electron", pid: 501 }, false],
    ["(d) bridge", { launchSource: "bridge", pid: 500 }, false],
    ["(e) standalone", { launchSource: "standalone", pid: 500 }, false],
  ];
  for (const [name, health, shouldPost] of table) {
    it(`E9 ${name} → ${shouldPost ? "POST /api/shutdown {userQuit:true}" : "no POST"}`, async () => {
      setSpawnedPid(500);
      const server = fakeServer(health, 0);
      await run(server);
      if (shouldPost) {
        expect(server.posts).toHaveLength(1);
        expect(JSON.parse(String(server.posts[0]!.body))).toEqual({ userQuit: true });
      } else {
        expect(server.posts).toHaveLength(0);
      }
    });
  }

  it("X9 awaits the server's exit: resolves once health refuses, POST sent once", async () => {
    setSpawnedPid(500);
    const server = fakeServer({ launchSource: "electron", pid: 500 }, 600);
    const took = await run(server);
    expect(took).toBeGreaterThanOrEqual(600);
    expect(took).toBeLessThan(1000);
    expect(server.posts).toHaveLength(1);
  });

  it("P3 caps the exit wait at 5 s, polling every 200 ms", async () => {
    setSpawnedPid(500);
    const server = fakeServer({ launchSource: "electron", pid: 500 }, Number.POSITIVE_INFINITY);
    const took = await run(server);
    expect(took).toBeGreaterThanOrEqual(5000);
    expect(took).toBeLessThanOrEqual(5200);
    // 1 ownership GET + ~25 exit polls
    expect(server.healthGets()).toBeGreaterThanOrEqual(24);
    expect(server.healthGets()).toBeLessThanOrEqual(27);
  });
});
