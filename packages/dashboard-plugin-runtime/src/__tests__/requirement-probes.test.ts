/**
 * Tests for requirement-probes (probePiExtension / probeBinary / probeService /
 * runRequirementProbes / TTL cache). See change: add-plugin-activation-ui.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  probePiExtension,
  probeBinary,
  probeService,
  runRequirementProbes,
  missingFromReport,
  getCachedReport,
  setCachedReport,
  clearRequirementCache,
} from "../server/requirement-probes.js";

beforeEach(() => clearRequirementCache());

describe("probePiExtension", () => {
  it("satisfied when listInstalled has matching name", async () => {
    const r = await probePiExtension("pi-web-access", {
      listInstalled: async () => [{ name: "pi-web-access" }],
    });
    expect(r).toEqual({ name: "pi-web-access", satisfied: true });
  });

  it("satisfied when source is npm:<name>", async () => {
    const r = await probePiExtension("pi-web-access", {
      listInstalled: async () => [{ source: "npm:pi-web-access" }],
    });
    expect(r.satisfied).toBe(true);
  });

  it("satisfied when an npm-declared extension is installed from a local path", async () => {
    // global-from-local-build: source is a filesystem path, requirement
    // name is an npm-style scoped id. Resolved via the npm ↔ raw matcher.
    const r = await probePiExtension("@blackbelt-technology/pi-dashboard-subagents", {
      listInstalled: async () => [{ source: "/home/dev/pi-dashboard-subagents" }],
    });
    expect(r.satisfied).toBe(true);
  });

  it("not satisfied when listInstalled is missing", async () => {
    const r = await probePiExtension("pi-web-access", {});
    expect(r.satisfied).toBe(false);
  });

  it("not satisfied when name is not present", async () => {
    const r = await probePiExtension("pi-web-access", {
      listInstalled: async () => [{ name: "something-else" }],
    });
    expect(r.satisfied).toBe(false);
  });
});

describe("probeBinary", () => {
  it("satisfied when tool registry resolves the name", () => {
    const r = probeBinary("rg", {
      toolRegistry: { resolve: () => ({ ok: true, resolvedPath: "/usr/bin/rg" }) },
    });
    expect(r).toEqual({ name: "rg", satisfied: true, resolvedPath: "/usr/bin/rg" });
  });

  it("not satisfied when tool registry returns ok=false", () => {
    const r = probeBinary("rg", { toolRegistry: { resolve: () => ({ ok: false }) } });
    expect(r.satisfied).toBe(false);
  });

  it("not satisfied without a tool registry", () => {
    const r = probeBinary("rg", {});
    expect(r.satisfied).toBe(false);
  });
});

describe("probeService", () => {
  it("returns satisfied=false with error for unknown service name", async () => {
    const r = await probeService("unknown-service-name", {});
    expect(r).toEqual({
      name: "unknown-service-name",
      satisfied: false,
      error: "unknown service name",
    });
  });

  it("dispatches to pi-model-proxy probe", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: "anthropic/claude" }] }), { status: 200 })) as any;
    const r = await probeService("pi-model-proxy", { fetchImpl });
    expect(r.satisfied).toBe(true);
  });
});

describe("runRequirementProbes", () => {
  it("returns empty arrays when manifest has no requires", async () => {
    const report = await runRequirementProbes(
      { id: "x", displayName: "X", claims: [] },
      {},
    );
    expect(report).toEqual({ piExtensions: [], binaries: [], services: [] });
    expect(missingFromReport(report)).toEqual([]);
  });

  it("reports mixed satisfied/unsatisfied", async () => {
    const fetchImpl = (async (url: string) => {
      if (typeof url === "string" && url.includes("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    }) as any;
    const report = await runRequirementProbes(
      {
        id: "x",
        displayName: "X",
        claims: [],
        requires: {
          piExtensions: ["foo-ext"],
          binaries: ["rg", "nonexistent-binary"],
          services: ["pi-model-proxy"],
        },
      },
      {
        listInstalled: async () => [{ name: "something-else" }],
        toolRegistry: {
          resolve: (n: string) =>
            n === "rg" ? { ok: true, resolvedPath: "/usr/bin/rg" } : { ok: false },
        },
        fetchImpl,
      },
    );

    expect(report.piExtensions).toEqual([{ name: "foo-ext", satisfied: false }]);
    expect(report.binaries).toEqual([
      { name: "rg", satisfied: true, resolvedPath: "/usr/bin/rg" },
      { name: "nonexistent-binary", satisfied: false },
    ]);
    expect(report.services[0].satisfied).toBe(true);
    expect(missingFromReport(report).sort()).toEqual(["foo-ext", "nonexistent-binary"]);
  });
});

describe("TTL cache", () => {
  it("returns null on cache miss", () => {
    expect(getCachedReport("x")).toBeNull();
  });

  it("returns the report inside the TTL window", () => {
    const now = 10_000;
    setCachedReport("x", { piExtensions: [], binaries: [], services: [] }, now);
    expect(getCachedReport("x", now + 1_000)).toEqual({
      piExtensions: [],
      binaries: [],
      services: [],
    });
  });

  it("returns null after the TTL window", () => {
    const now = 10_000;
    setCachedReport("x", { piExtensions: [], binaries: [], services: [] }, now);
    expect(getCachedReport("x", now + 31_000)).toBeNull();
  });
});
