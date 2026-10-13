/**
 * pi-resources fresh reads + invalidation listeners (host seams for plugins).
 * test-plan ids (add-skill-atlas-screen): X1, E22 host half.
 * See change: add-skill-atlas-screen (design D4, D5).
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

describe("refreshPiResourcesFresh", () => {
  it("X1: an in-flight scan that started before the call does not satisfy a fresh read", async () => {
    const { service } = mk();
    const cwd = project("repo");
    let release!: () => void;
    const first = new Promise<void>((r) => { release = r; });
    const ADDED = { ...EMPTY, local: { ...EMPTY.local, skills: [{ name: "added-skill" }] } };
    scanPiResources
      .mockImplementationOnce(async () => { await first; return EMPTY; })
      .mockImplementationOnce(async () => ADDED);
    const stale = service.refreshPiResources(cwd); // scan #1 running (pre-edit)
    const fresh = service.refreshPiResourcesFresh(cwd); // skill added after scan #1 started
    release();
    await expect(stale).resolves.toBe(EMPTY);
    await expect(fresh).resolves.toBe(ADDED);
    expect(scanPiResources).toHaveBeenCalledTimes(2);
  });

  it("starts a scan when none is in flight and resolves with it", async () => {
    const { service } = mk();
    const cwd = project("repo2");
    await expect(service.refreshPiResourcesFresh(cwd)).resolves.toBe(EMPTY);
    expect(scanPiResources).toHaveBeenCalledTimes(1);
  });
});

describe("onPiResourcesInvalidated", () => {
  it("watcher invalidation fans out the cwd; global fans out undefined", async () => {
    const w = fakeWatch();
    const { service } = mk(w);
    const cwd = project("repo3");
    const seen: Array<string | undefined> = [];
    service.onPiResourcesInvalidated((c) => seen.push(c));
    await service.refreshPiResources(cwd);
    w.listeners.get(path.join(cwd, ".pi", "skills"))?.("rename", "new-skill");
    w.listeners.get(path.join(home, ".pi", "agent"))?.("change", "settings.json");
    expect(seen).toEqual([cwd, undefined]);
  });

  it("notifyPiResourcesInvalidated reaches listeners; a throwing listener is isolated; unsubscribe stops calls", () => {
    const { service } = mk();
    const seen: Array<string | undefined> = [];
    service.onPiResourcesInvalidated(() => { throw new Error("boom"); });
    const unsub = service.onPiResourcesInvalidated((c) => seen.push(c));
    expect(() => service.notifyPiResourcesInvalidated("/repo")).not.toThrow();
    unsub();
    service.notifyPiResourcesInvalidated("/repo");
    expect(seen).toEqual(["/repo"]);
  });
});
