/**
 * buildPidNamespace — the one builder for a pi process's pid-namespace report
 * (bridge register sites, the ACP bridge, and the server's own context).
 * Test-plan rows E50–E57. See change: scope-pids-to-namespace.
 */
import { describe, expect, it, vi } from "vitest";
import { buildPidNamespace, type PidNamespaceOpts } from "../pid-namespace.js";

const NS_LINK = "/proc/self/ns/pid";
const BOOT_ID = "/proc/sys/kernel/random/boot_id";

function linuxOpts(over: Partial<PidNamespaceOpts> = {}): PidNamespaceOpts {
  return {
    platform: "linux",
    env: {},
    readlink: vi.fn((p: string) => {
      if (p === NS_LINK) return "pid:[4026531840]";
      throw new Error(`unexpected readlink ${p}`);
    }),
    readFile: vi.fn((p: string) => {
      if (p === BOOT_ID) return "boot-W\n";
      throw new Error(`unexpected readFile ${p}`);
    }),
    hostname: vi.fn(() => "linuxbox"),
    ...over,
  };
}

describe("buildPidNamespace", () => {
  it("E50: a bridge inside WSL reports distro + namespace", () => {
    const ns = buildPidNamespace(linuxOpts({ env: { WSL_DISTRO_NAME: "Ubuntu-24.04" } }));
    expect(ns).toEqual({
      platform: "linux",
      kind: "wsl",
      distro: "Ubuntu-24.04",
      nsId: "pid:[4026531840]",
      hostId: "boot-W",
    });
  });

  it("E51: kind is host and no distro key when WSL_DISTRO_NAME is unset or empty", () => {
    for (const env of [{}, { WSL_DISTRO_NAME: "" }]) {
      const ns = buildPidNamespace(linuxOpts({ env }));
      expect(ns.kind).toBe("host");
      expect("distro" in ns).toBe(false);
    }
  });

  it("E52: an unreadable nsId is omitted, no throw", () => {
    const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
    const ns = buildPidNamespace(
      linuxOpts({
        readlink: () => {
          throw err;
        },
      }),
    );
    expect("nsId" in ns).toBe(false);
    expect(ns.hostId).toBe("boot-W");
  });

  it("E53: an unreadable boot_id is omitted with no hostname fallback on Linux", () => {
    const hostname = vi.fn(() => "linuxbox");
    const ns = buildPidNamespace(
      linuxOpts({
        hostname,
        readFile: () => {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        },
      }),
    );
    expect("hostId" in ns).toBe(false);
    expect(hostname).not.toHaveBeenCalled();
  });

  it("E54: non-Linux never reads /proc and uses the hostname", () => {
    for (const [platform, host] of [
      ["darwin", "mac.local"],
      ["win32", "WINBOX"],
    ] as const) {
      const readlink = vi.fn();
      const readFile = vi.fn();
      const ns = buildPidNamespace({ platform, env: {}, readlink, readFile, hostname: () => host });
      expect(ns).toEqual({ platform, kind: "host", hostId: host });
      expect(readlink).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
    }
  });

  it("E55: a hostname failure omits hostId without throwing", () => {
    const ns = buildPidNamespace({
      platform: "win32",
      env: {},
      readlink: vi.fn(),
      readFile: vi.fn(),
      hostname: () => {
        throw new Error("boom");
      },
    });
    expect(ns).toEqual({ platform: "win32", kind: "host" });
  });

  it("E56: an omitted field stays absent on the wire (not null)", () => {
    const ns = buildPidNamespace(
      linuxOpts({
        readlink: () => {
          throw new Error("EACCES");
        },
      }),
    );
    const wire = JSON.parse(JSON.stringify({ type: "session_register", pid: 1, pidNamespace: ns }));
    expect(Object.hasOwn(wire.pidNamespace, "nsId")).toBe(false);
  });

  it("E57: the server context and the bridge builder agree on the same inputs", async () => {
    const { buildServerPidContext } = await import("../pid-namespace.js");
    const opts = linuxOpts();
    const ns = buildPidNamespace(opts);
    const ctx = buildServerPidContext(opts);
    expect({ platform: ctx.platform, hostId: ctx.hostId, nsId: ctx.nsId }).toEqual({
      platform: ns.platform,
      hostId: ns.hostId,
      nsId: ns.nsId,
    });
  });
});
