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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
