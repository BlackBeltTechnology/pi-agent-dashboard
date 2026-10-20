/**
 * Live-server manager: addedBy, preset / static targets, LRU caps, own-port refusal.
 * See change: improve-canvas-html-and-url-ux (tasks 1.2, 1.4; test-plan E5–E8).
 */
import { validateLiveTarget } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { describe, expect, it } from "vitest";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import {
  createLiveServerManager,
  MAX_PRESETS_PER_SESSION,
  MAX_STATIC_PER_CWD,
} from "../live-server/live-server-manager.js";

function fakePrefs(initial: unknown[] = []) {
  let store: any[] = initial as any[];
  let writes = 0;
  return {
    getLiveServers: () => store,
    setLiveServers: (t: any[]) => {
      store = t;
      writes++;
    },
    get writes() {
      return writes;
    },
    get stored() {
      return store;
    },
  } as any;
}

describe("E5 — only user targets are persisted; legacy seeds as legacy", () => {
  it("user + preset + static + seeded legacy: restart keeps user + legacy only", () => {
    const prefs = fakePrefs([{ id: "old00001", label: "old", host: "127.0.0.1", port: 3000 }]);
    const m1 = createLiveServerManager(prefs);
    expect(m1.list().find((t) => t.id === "old00001")?.addedBy).toBe("legacy");
    const user = m1.start({ host: "localhost", port: 5173, label: "vite" });
    const preset = m1.startPreset({ host: "127.0.0.1", port: 6000, sessionId: "s1" });
    const stat = m1.startStatic({ cwd: "/p", root: "/p/m/a" });
    expect(user.ok && user.target.addedBy).toBe("user");
    expect(preset.ok && preset.target.addedBy).toBe("preset");
    expect(stat.ok).toBe(true);

    // The store holds exactly the user target + the legacy entry (unchanged shape).
    const ports = prefs.stored.map((t: any) => t.port).sort();
    expect(ports).toEqual([3000, 5173]);
    expect(prefs.stored.find((t: any) => t.port === 3000)).toEqual({
      id: "old00001",
      label: "old",
      host: "127.0.0.1",
      port: 3000,
    });
    expect(prefs.stored.find((t: any) => t.port === 5173).addedBy).toBe("user");

    // Simulated restart: re-seed from the store.
    const m2 = createLiveServerManager(prefs);
    expect(
      m2
        .list()
        .map((t) => [t.port, t.addedBy])
        .sort(),
    ).toEqual([
      [3000, "legacy"],
      [5173, "user"],
    ]);
    expect(stat.ok && m2.getStatic(stat.target.id)).toBeFalsy();
    expect(preset.ok && m2.get(preset.target.id)).toBeFalsy();
  });

  it("start({addedBy:'preset'}) stays in memory; an explicit user add promotes it and persists", () => {
    const prefs = fakePrefs();
    const m = createLiveServerManager(prefs);
    const p = m.start({ host: "127.0.0.1", port: 7000, addedBy: "preset", sessionId: "s" });
    expect(p.ok && p.target.addedBy).toBe("preset");
    expect(prefs.writes).toBe(0);
    const u = m.start({ host: "127.0.0.1", port: 7000 });
    expect(u.ok && u.target.id).toBe(p.ok && p.target.id);
    expect(u.ok && u.target.addedBy).toBe("user");
    expect(prefs.stored).toHaveLength(1);
    // A later preset request never downgrades a user target.
    const again = m.startPreset({ host: "127.0.0.1", port: 7000, sessionId: "s" });
    expect(again.ok && again.target.addedBy).toBe("user");
  });

  it("static registration is idempotent by (cwd, root) and never listed", () => {
    const m = createLiveServerManager(fakePrefs());
    const a = m.startStatic({ cwd: "/p", root: "/p/x" });
    const b = m.startStatic({ cwd: "/p", root: "/p/x" });
    expect(a.ok && b.ok && a.target.id === b.target.id).toBe(true);
    expect(m.list()).toEqual([]);
    expect(a.ok && m.has(a.target.id)).toBe(true);
    expect(a.ok && m.get(a.target.id)).toBeUndefined(); // not a PORT target
  });
});

describe("E6 — LRU caps revoke the evicted target's tokens", () => {
  it("17th preset evicts the LRU (not the recently used #3); 33rd static likewise", () => {
    const m = createLiveServerManager(fakePrefs());
    const evicted: string[] = [];
    const store = new LiveCapabilityStore({ isTargetLive: (id) => m.has(id) });
    m.setEvictionListener((id) => {
      evicted.push(id);
      store.revokeByTarget(id);
    });
    const ids: string[] = [];
    for (let i = 0; i < MAX_PRESETS_PER_SESSION; i++) {
      const r = m.startPreset({ host: "127.0.0.1", port: 9000 + i, sessionId: "s" });
      ids.push(r.ok ? r.target.id : "");
    }
    const tokens = ids.map((id) => store.mint(id, { kind: "local" }).token);
    m.use(ids[2]); // preset #3 used via an accepted request
    const extra = m.startPreset({ host: "127.0.0.1", port: 9100, sessionId: "s" });
    expect(extra.ok).toBe(true);
    expect(evicted).toEqual([ids[0]]); // LRU is #1 (not #3)
    expect(m.has(ids[2])).toBe(true);
    expect(m.list().filter((t) => t.addedBy === "preset")).toHaveLength(MAX_PRESETS_PER_SESSION);
    expect(store.validate(ids[0], tokens[0])).toBeNull();
    expect(store.validate(ids[2], tokens[2])).not.toBeNull();
    // Another session's presets are counted separately.
    expect(m.startPreset({ host: "127.0.0.1", port: 9200, sessionId: "other" }).ok).toBe(true);
    expect(evicted).toHaveLength(1);

    const statics: string[] = [];
    for (let i = 0; i < MAX_STATIC_PER_CWD; i++) {
      const r = m.startStatic({ cwd: "/p", root: `/p/r${i}` });
      statics.push(r.ok ? r.target.id : "");
    }
    m.use(statics[2]);
    const sTok = store.mint(statics[0], { kind: "local" }).token;
    expect(m.startStatic({ cwd: "/p", root: "/p/overflow" }).ok).toBe(true);
    expect(evicted).toEqual([ids[0], statics[0]]);
    expect(m.getStatic(statics[0])).toBeUndefined();
    expect(m.getStatic(statics[2])).toBeDefined();
    expect(store.validate(statics[0], sTok)).toBeNull();
    // A different cwd has its own budget.
    expect(m.startStatic({ cwd: "/q", root: "/q/a" }).ok).toBe(true);
    expect(evicted).toHaveLength(2);
  });
});

describe("E7 — the dashboard's own ports are refused", () => {
  const m = createLiveServerManager(fakePrefs(), { ownPorts: () => [8000, 8443] });
  it("start and startPreset refuse 8000 / 8443 on every loopback spelling; 5173 is accepted", () => {
    for (const fn of [m.start, m.startPreset]) {
      expect(fn({ host: "localhost", port: 8000 }).ok).toBe(false);
      expect(fn({ host: "127.0.0.1", port: 8443 }).ok).toBe(false);
      expect(fn({ host: "::1", port: 8000 }).ok).toBe(false);
    }
    expect(m.start({ host: "localhost", port: 5173 }).ok).toBe(true);
    expect(m.startPreset({ host: "localhost", port: 5174 }).ok).toBe(true);
    expect(m.start({ host: "localhost", port: 8000, addedBy: "preset" }).ok).toBe(false);
  });

  it("a persisted entry on an own port is dropped on seed", () => {
    const prefs = fakePrefs([{ id: "own00001", label: "x", host: "127.0.0.1", port: 8000 }]);
    const m2 = createLiveServerManager(prefs, { ownPorts: () => [8000] });
    expect(m2.list()).toEqual([]);
    expect(prefs.stored).toEqual([]);
  });
});

describe("E8 — rollback: today's seed function accepts a store written by this change", () => {
  /** Fixture copy of the pre-change `createLiveServerManager` seeding loop. */
  function oldSeed(persisted: any[]) {
    const targets = new Map<string, unknown>();
    let seededDirty = false;
    for (const t of persisted) {
      const v = validateLiveTarget(t);
      if (!v.ok || typeof t.id !== "string" || !t.id) {
        seededDirty = true;
        continue;
      }
      targets.set(t.id, { id: t.id, label: v.label, host: v.host, port: v.port });
    }
    return { targets, seededDirty };
  }

  it("an entry carrying addedBy is seeded, not dropped, and the store is not marked dirty", () => {
    const prefs = fakePrefs();
    const m = createLiveServerManager(prefs);
    m.start({ host: "127.0.0.1", port: 4321, label: "docs" });
    expect(prefs.stored[0].addedBy).toBe("user");
    const { targets, seededDirty } = oldSeed(prefs.stored);
    expect(targets.size).toBe(1);
    expect(seededDirty).toBe(false);
    expect(
      oldSeed([{ id: "a1", label: "x", host: "127.0.0.1", port: 4321, addedBy: "user" }]).seededDirty,
    ).toBe(false);
  });
});
