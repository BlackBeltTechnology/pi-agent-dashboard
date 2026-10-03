/**
 * pi-resources on demand (stale-while-revalidate) — no background timer,
 * watch invalidation, LRU caps, reconciliation.
 * test-plan ids: E43 E44 E45 E46 E47 E48 E49 E50 E51 X8 X9.
 * See change: optimize-polling-hot-paths (D9).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";

const { scanPiResources } = vi.hoisted(() => ({ scanPiResources: vi.fn() }));
vi.mock("../pi/pi-resource-scanner.js", () => ({ scanPiResources }));

const EMPTY = { local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] };

const prefs = new Proxy(
  { getPinnedDirectories: () => [] as string[] },
  { get: (t: any, k: string) => (k in t ? t[k] : vi.fn(() => undefined)) },
) as unknown as PreferencesStore;
const sessions = { listAll: () => [], listActive: () => [], get: () => undefined } as unknown as SessionManager;

type Listener = (event: string, filename: string | Buffer | null) => void;

function fakeWatch(failFor: (dir: string) => boolean = () => false) {
  const listeners = new Map<string, Listener>();
  const closed: string[] = [];
  const watch = (dir: string, _o: unknown, l: Listener) => {
    if (failFor(dir)) throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
    listeners.set(dir, l);
    return { close: () => { closed.push(dir); listeners.delete(dir); }, on: () => ({}) as any } as any;
  };
  return { watch, listeners, closed };
}

let tmp: string;
let home: string;
let now: number;
let service: DirectoryService | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ds-pires-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".pi", "agent", "skills"), { recursive: true });
  now = 1_000_000;
  scanPiResources.mockReset();
  scanPiResources.mockImplementation(async () => EMPTY);
});
afterEach(() => {
  service?.stopPolling();
  service = undefined;
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mk(w = fakeWatch(), extra: object = {}) {
  service = createDirectoryService(prefs, sessions, { enabled: true, pollIntervalSeconds: 60 } as any, {
    piResourcesWatch: { watch: w.watch as any, homeDir: home },
    now: () => now,
    ...extra,
  } as any);
  return { service, w };
}

function project(name: string, subdirs: string[] = ["skills"]) {
  const cwd = path.join(tmp, name);
  for (const s of subdirs) fs.mkdirSync(path.join(cwd, ".pi", s), { recursive: true });
  return cwd;
}

describe("pi-resources on demand", () => {
  it("E43: cold request without a cwd scans and caches under the given key", async () => {
    const { service } = mk();
    const key = process.cwd();
    expect(service.getPiResources(key)).toBeUndefined();
    await service.refreshPiResources(key);
    expect(service.getPiResources(key)).toMatchObject({ stale: false });
  });

  it("E44: startPolling with no requests → 30 min later scanPiResources was never called", async () => {
    const { service } = mk();
    service.startPolling(() => {});
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(scanPiResources).not.toHaveBeenCalled();
  });

  it("E45: 5-minute staleness boundary (4:59 fresh, 5:00 stale)", async () => {
    const { service } = mk();
    const cwd = project("p1");
    await service.refreshPiResources(cwd);
    now += 4 * 60_000 + 59_000;
    expect(service.getPiResources(cwd)?.stale).toBe(false);
    now += 1_000;
    expect(service.getPiResources(cwd)?.stale).toBe(true);
  });

  it("E46: two concurrent cold misses share one scan", async () => {
    const { service } = mk();
    let resolve!: (v: unknown) => void;
    scanPiResources.mockImplementation(() => new Promise((r) => (resolve = r)));
    const a = service.refreshPiResources("/x");
    const b = service.refreshPiResources("/x");
    resolve(EMPTY);
    await expect(Promise.all([a, b])).resolves.toEqual([EMPTY, EMPTY]);
    expect(scanPiResources).toHaveBeenCalledTimes(1);
  });

  it("E47: a local skills/ event and a global settings.json event invalidate", async () => {
    const { service, w } = mk();
    const a = project("a");
    const b = project("b");
    await service.refreshPiResources(a);
    await service.refreshPiResources(b);
    expect(service.getPiResources(a)?.stale).toBe(false);
    w.listeners.get(path.join(a, ".pi", "skills"))!("rename", "new.md");
    expect(service.getPiResources(a)?.stale).toBe(true);
    expect(service.getPiResources(b)?.stale).toBe(false); // local event is per cwd
    await service.refreshPiResources(a);
    w.listeners.get(path.join(home, ".pi", "agent"))!("change", "settings.json");
    expect(service.getPiResources(a)?.stale).toBe(true);
    expect(service.getPiResources(b)?.stale).toBe(true); // global marks all
  });

  it("E48: a resource dir created later is attached on the next reconcile and its events invalidate", async () => {
    const { service, w } = mk();
    const cwd = project("c", []);
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    await service.refreshPiResources(cwd);
    expect(w.listeners.has(path.join(cwd, ".pi", "skills"))).toBe(false);
    fs.mkdirSync(path.join(cwd, ".pi", "skills"));
    w.listeners.get(path.join(cwd, ".pi"))!("rename", "skills"); // directory creation
    expect(service.getPiResources(cwd)?.stale).toBe(true);
    expect(w.listeners.has(path.join(cwd, ".pi", "skills"))).toBe(true);
  });

  it("E49: 17 cwds keep 16 watchers (data kept); 65 cwds keep 64 data entries", async () => {
    const { service, w } = mk();
    const cwds = Array.from({ length: 17 }, (_, i) => project(`w${i}`));
    for (const c of cwds) await service.refreshPiResources(c);
    expect(w.closed.some((d) => d.startsWith(path.join(cwds[0]!, ".pi")))).toBe(true);
    expect(service.getPiResources(cwds[0]!)).toBeDefined(); // data kept
    expect(service.getPiResources(cwds[0]!)?.stale).toBe(true); // unwatched ⇒ revalidated
    const more = Array.from({ length: 48 }, (_, i) => path.join(tmp, `m${i}`));
    for (const c of more) await service.refreshPiResources(c);
    expect(service.getPiResources(cwds[1]!)).toBeUndefined(); // least recent dropped
    expect(service.getPiResources(more.at(-1)!)).toBeDefined();
  });

  it("E50: with OpenSpec disabled the poll timer still releases idle watchers and keeps data stale", async () => {
    const { service, w } = mk(fakeWatch(), {});
    service.reconfigurePolling({ enabled: false, pollIntervalSeconds: 60, maxConcurrentSpawns: 2, jitterSeconds: 0, offerInitialization: true, optOutDirectories: [] } as any);
    const cwd = project("d");
    service.startPolling(() => {});
    await service.refreshPiResources(cwd);
    now += 11 * 60_000;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(w.closed.some((d) => d.startsWith(path.join(cwd, ".pi")))).toBe(true);
    expect(service.getPiResources(cwd)).toMatchObject({ stale: true });
  });

  it("E51: refresh=true path — an explicit refresh awaits a fresh scan and stores it", async () => {
    const { service } = mk();
    const cwd = project("e");
    await service.refreshPiResources(cwd);
    scanPiResources.mockResolvedValueOnce({ ...EMPTY, packages: [{ name: "new" }] });
    const data = await service.refreshPiResources(cwd);
    expect((data as any).packages[0].name).toBe("new");
    expect((service.getPiResources(cwd)!.data as any).packages[0].name).toBe("new");
  });

  it("X8: every watch attach throws → still served; stale at the 5-minute bound", async () => {
    const { service } = mk(fakeWatch(() => true));
    const cwd = project("f");
    await service.refreshPiResources(cwd);
    now += 4 * 60_000;
    expect(service.getPiResources(cwd)?.stale).toBe(false);
    now += 60_000;
    expect(service.getPiResources(cwd)?.stale).toBe(true);
  });

  it("X9: a rejecting rescan leaves the stale entry served and the next request retries", async () => {
    const { service } = mk();
    const cwd = project("g");
    await service.refreshPiResources(cwd);
    now += 6 * 60_000;
    scanPiResources.mockRejectedValueOnce(new Error("scan boom"));
    await expect(service.refreshPiResources(cwd)).rejects.toThrow("scan boom");
    expect(service.getPiResources(cwd)).toMatchObject({ stale: true }); // still served
    await service.refreshPiResources(cwd); // retry succeeds
    expect(service.getPiResources(cwd)).toMatchObject({ stale: false });
  });

  it("an invalidation during a scan leaves the fresh result stale", async () => {
    const { service, w } = mk();
    const cwd = project("h");
    let resolve!: (v: unknown) => void;
    scanPiResources.mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = service.refreshPiResources(cwd);
    w.listeners.get(path.join(cwd, ".pi", "skills"))!("rename", "x.md");
    resolve(EMPTY);
    await p;
    expect(service.getPiResources(cwd)?.stale).toBe(true);
  });

  it("B2: a poll tick with 17 recently requested cwds keeps ≤ 16 watchers (no attach/detach thrash)", async () => {
    const { service, w } = mk();
    const cwds = Array.from({ length: 17 }, (_, i) => project(`t${i}`));
    for (const c of cwds) await service.refreshPiResources(c);
    const watchedCwds = () => cwds.filter((c) => w.listeners.has(path.join(c, ".pi", "skills"))).length;
    expect(watchedCwds()).toBe(16);
    service.startPolling(() => {});
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(watchedCwds()).toBe(16);
    // The oldest is the one left unwatched, and it is served stale, not dropped.
    expect(w.listeners.has(path.join(cwds[0]!, ".pi", "skills"))).toBe(false);
    expect(service.getPiResources(cwds[0]!)).toMatchObject({ stale: true });
  });
});
