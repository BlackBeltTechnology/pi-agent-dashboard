/**
 * Adapter version-floor probe (change extract-mcp-client-plugin, task 2.3).
 */

import { describe, expect, it } from "vitest";
import {
  ADAPTER_VERSION_FLOOR,
  adapterProbePaths,
  compareSemver,
  createAdapterVerdictProbe,
  probeAdapterVersion,
} from "../adapter-verdict.js";
import type { ConfigIO } from "../types.js";

function ioWith(files: Record<string, string>): ConfigIO & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readFile: (p) => {
      reads.push(p);
      return p in files ? files[p] : null;
    },
    writeFileAtomic: () => {
      throw new Error("probe must never write");
    },
  };
}

const AGENT_DIR = "/custom/agent";

function makeProbe(files: Record<string, string> = {}, now?: () => number) {
  const io = ioWith(files);
  const probe = createAdapterVerdictProbe({
    configIO: io,
    adapter: { getPiGlobalConfigPath: () => `${AGENT_DIR}/mcp.json` },
    ...(now ? { now } : {}),
  });
  return { io, probe };
}

const adapterPkg = (v: string) => JSON.stringify({ name: "pi-mcp-adapter", version: v });

describe("probeAdapterVersion", () => {
  it("classifies below-floor, ok, unparseable and absent", () => {
    expect(probeAdapterVersion("2.19.99")).toMatchObject({ kind: "below-floor", installed: "2.19.99", floor: ADAPTER_VERSION_FLOOR });
    for (const v of ["2.20.0", "2.20.1", "2.30.0", "3.0.0-beta.1"]) {
      expect(probeAdapterVersion(v), v).toMatchObject({ kind: "ok", installed: v });
    }
    expect(probeAdapterVersion("garbage")).toMatchObject({ kind: "unparseable", installed: "garbage" });
    expect(probeAdapterVersion(null)).toMatchObject({ kind: "absent" });
  });

  it("exposes both installed and floor on below-floor", () => {
    const v = probeAdapterVersion("2.19.0");
    expect(v.installed).toBe("2.19.0");
    expect(v.floor).toBe("2.20.0");
  });

  it("ignores prerelease suffixes (includePrerelease)", () => {
    expect(compareSemver("2.20.0-beta.1", "2.20.0")).toBe(0);
    expect(compareSemver("2.19.9", "2.20.0")).toBeLessThan(0);
  });
});

describe("createAdapterVerdictProbe", () => {
  it("reads the npm-installed location under the resolved agent dir", () => {
    const { probe } = makeProbe({ [`${AGENT_DIR}/npm/node_modules/pi-mcp-adapter/package.json`]: adapterPkg("2.31.0") });
    expect(probe.adapterVerdict()).toMatchObject({ kind: "ok", installed: "2.31.0" });
  });

  it("falls back to the local node_modules location", () => {
    const { probe } = makeProbe({ [`${AGENT_DIR}/node_modules/pi-mcp-adapter/package.json`]: adapterPkg("2.20.0") });
    expect(probe.adapterVerdict()).toMatchObject({ kind: "ok" });
  });

  it("reports absent when neither location exists and never stat's ~/.pi/agent", () => {
    const { io, probe } = makeProbe();
    expect(probe.adapterVerdict()).toMatchObject({ kind: "absent" });
    expect(io.reads.every((p) => p.startsWith(AGENT_DIR))).toBe(true);
  });

  it("caches for 30s and re-probes after the TTL", () => {
    let t = 1_000_000;
    const files: Record<string, string> = { [`${AGENT_DIR}/npm/node_modules/pi-mcp-adapter/package.json`]: adapterPkg("2.31.0") };
    const { io, probe } = makeProbe(files, () => t);

    expect(probe.adapterVerdict()).toMatchObject({ kind: "ok" });
    const readsAfterFirst = io.reads.length;

    t += 29_900;
    expect(probe.adapterVerdict()).toMatchObject({ kind: "ok" });
    expect(io.reads.length).toBe(readsAfterFirst);

    files[`${AGENT_DIR}/npm/node_modules/pi-mcp-adapter/package.json`] = adapterPkg("2.0.0");
    t += 200;
    expect(probe.adapterVerdict()).toMatchObject({ kind: "below-floor", installed: "2.0.0" });
    expect(io.reads.length).toBeGreaterThan(readsAfterFirst);
  });

  it("`fresh` bypasses the cache (install action busts it)", () => {
    const t = 1_000_000;
    const files: Record<string, string> = { [`${AGENT_DIR}/npm/node_modules/pi-mcp-adapter/package.json`]: adapterPkg("2.31.0") };
    const { io, probe } = makeProbe(files, () => t);
    probe.adapterVerdict();
    const readsAfterFirst = io.reads.length;
    expect(probe.adapterVerdict({ fresh: true })).toMatchObject({ kind: "ok" });
    expect(io.reads.length).toBeGreaterThan(readsAfterFirst);
  });
});

describe("adapterProbePaths", () => {
  it("lists npm/ then node_modules/ under the agent dir", () => {
    expect(adapterProbePaths("/a")).toEqual([
      "/a/npm/node_modules/pi-mcp-adapter/package.json",
      "/a/node_modules/pi-mcp-adapter/package.json",
    ]);
  });
});
