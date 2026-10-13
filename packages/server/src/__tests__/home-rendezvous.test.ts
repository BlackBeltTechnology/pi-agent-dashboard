/**
 * The rendezvous record is actually established at startup, and an attach-mode
 * instance promotes itself when the owner dies.
 *
 * (test-plan #E14, #E15) Tasks 2.0a, 2.0c, 2.0j, 2.0j-i.
 * See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMetadata } from "../lifecycle/home-lock.js";
import { establishHomeRendezvous } from "../lifecycle/home-rendezvous.js";

let tmpHome: string;
let lockPath: string;
let metaPath: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-home-rdv-"));
  lockPath = path.join(tmpHome, ".pi", "dashboard", "server.lock");
  metaPath = `${lockPath}.meta.json`;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

const start = (identity: string, over: Record<string, unknown> = {}) =>
  establishHomeRendezvous({
    httpPort: 8000,
    piPort: 9999,
    version: "0.0.0-test",
    identity,
    // No handler installation in tests — a real `process.on("exit")` per case
    // leaks listeners across the file.
    installHandlers: false,
    promotionIntervalMs: 0,
    hooks: {
      lockPath,
      metaPath,
      staleMs: 500,
      probeHealth: async () => ({ running: false }),
      isProcessAlive: () => false,
    },
    ...over,
  });

describe("establishHomeRendezvous", () => {
  // (task 2.0a) `home-lock` had NO production caller: no `server.lock` ever
  // appeared on disk for a running dashboard, so the record a bridge resolves
  // through simply did not exist.
  it("writes the rendezvous record on the acquiring instance", async () => {
    const rdv = await start("owner");
    expect(rdv.mode).toBe("acquired");
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(readMetadata(metaPath)?.identity).toBe("owner");
    await rdv.stop();
  });

  // (task 2.0c) An attach-mode instance serves only pinned bridges; it must
  // NOT claim the HOME's default by rewriting the record.
  it("an attach-mode instance does not touch the record", async () => {
    const owner = await start("owner");
    const second = await start("second", {
      hooks: {
        lockPath,
        metaPath,
        staleMs: 500,
        isProcessAlive: () => true,
        probeHealth: async () => ({ running: true, instanceId: "owner" }),
      },
    });
    expect(second.mode).toBe("attach");
    expect(readMetadata(metaPath)?.identity).toBe("owner");
    await second.stop();
    await owner.stop();
  });

  // (task 2.0j) Without promotion a crashed owner leaves every unpinned bridge
  // dialling a dead socket forever, and a clean shutdown leaves the HOME with
  // no default while a healthy instance is still running.
  it("an attach instance promotes itself once the owner is gone", async () => {
    const owner = await start("owner");
    let ownerAlive = true;
    const second = await start("second", {
      hooks: {
        lockPath,
        metaPath,
        staleMs: 500,
        isProcessAlive: () => ownerAlive,
        probeHealth: async () => (ownerAlive ? { running: true, instanceId: "owner" } : { running: false }),
      },
    });
    expect(second.mode).toBe("attach");

    // The owner goes away without releasing (a crash, not a shutdown).
    ownerAlive = false;
    await owner.release?.();

    await second.checkNow();
    expect(second.mode).toBe("acquired");
    expect(readMetadata(metaPath)?.identity).toBe("second");
    await second.stop();
  });

  // (task 2.0j-i) The promotion path is the same compare-and-swap takeover, so
  // a race between two attach instances must still leave one owner.
  it("two attach instances racing to promote yield exactly one owner", async () => {
    const owner = await start("owner");
    let ownerAlive = true;
    const attachHooks = {
      lockPath,
      metaPath,
      staleMs: 500,
      isProcessAlive: (pid: number) => (pid === process.pid ? true : ownerAlive),
      // A faithful probe answers for whoever currently holds the record, not
      // for a fixed identity: once one of the two has promoted itself, the
      // other must see a LIVE owner and stay attached.
      probeHealth: async () => {
        const rec = readMetadata(metaPath);
        if (rec && rec.identity !== "owner") return { running: true, instanceId: rec.identity };
        return ownerAlive ? { running: true, instanceId: "owner" } : { running: false };
      },
    };
    const a = await start("a", { hooks: attachHooks });
    const b = await start("b", { hooks: attachHooks });
    expect([a.mode, b.mode]).toEqual(["attach", "attach"]);

    ownerAlive = false;
    await owner.release?.();

    await Promise.all([a.checkNow(), b.checkNow()]);
    const owners = [a, b].filter((r) => r.mode === "acquired");
    expect(owners).toHaveLength(1);
    expect(readMetadata(metaPath)?.identity).toBe(owners[0]?.identity);

    await a.stop();
    await b.stop();
  });

  // (task 2.0a escape hatch) `PI_DASHBOARD_ALLOW_MULTIPLE` opts out entirely —
  // and opting out must not silently publish a record either.
  it("writes nothing when the lock is disabled", async () => {
    const rdv = await start("owner", { env: { PI_DASHBOARD_ALLOW_MULTIPLE: "1" } });
    expect(rdv.mode).toBe("disabled");
    expect(fs.existsSync(metaPath)).toBe(false);
    await rdv.stop();
  });
});

// See change: harden-dashboard-start-detection (D5.7; test-plan X14).
describe("promotion against a live-but-silent owner", () => {
  it("X14: stays attached and writes nothing while the owner is unresponsive", async () => {
    const owner = await start("owner");
    const logs: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    let mode: "match" | "silent" = "match";
    const second = await start("second", {
      log: (m: string) => logs.push(m),
      hooks: {
        lockPath,
        metaPath,
        staleMs: 500,
        isProcessAlive: () => true,
        probeHealth: async () =>
          mode === "match" ? { running: true, instanceId: "owner" } : { running: false, timedOut: true },
      },
    });
    expect(second.mode).toBe("attach");
    const before = fs.readFileSync(metaPath);

    mode = "silent";
    for (let i = 0; i < 3; i++) await second.checkNow();
    await new Promise((r) => setImmediate(r));
    process.off("unhandledRejection", onUnhandled);

    expect(second.mode).toBe("attach");
    expect(fs.readFileSync(metaPath).equals(before)).toBe(true);
    expect(unhandled).toEqual([]);
    expect(logs.filter((l) => /not responding/.test(l))).toHaveLength(3);
    await second.stop();
    await owner.stop();
  });

  it("drops the HOME-default role when its hold is compromised", async () => {
    const logs: string[] = [];
    const a = await start("a", {
      log: (m: string) => logs.push(m),
      hooks: {
        lockPath,
        metaPath,
        staleMs: 2000,
        probeHealth: async () => ({ running: false }),
        isProcessAlive: () => false,
        log: () => {},
      },
    });
    expect(a.mode).toBe("acquired");
    // A successor takes the lock over behind A's back. (The lock library tells
    // two holds apart by directory mtime in whole ms: let one tick pass so B's
    // directory cannot share A's.)
    await new Promise((r) => setTimeout(r, 25));
    fs.rmSync(`${lockPath}.lock`, { recursive: true, force: true });
    const b = await start("b", {
      hooks: { lockPath, metaPath, staleMs: 2000, probeHealth: async () => ({ running: false }), isProcessAlive: () => false, log: () => {} },
    });
    expect(b.mode).toBe("acquired");
    await vi.waitFor(() => expect(a.mode).toBe("attach"), { timeout: 12_000, interval: 50 });
    expect(a.release).toBeUndefined();
    expect(readMetadata(metaPath)?.identity).toBe("b");
    await a.stop();
    await b.stop();
  }, 30_000);
});
