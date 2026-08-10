/**
 * Tests for requirement-probes (probePiExtension / probeBinary / probeService /
 * runRequirementProbes / TTL cache). See change: add-plugin-activation-ui.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  probePiExtension,
  probeBinary,
  probeService,
  probePath,
  runRequirementProbes,
  runRequirementProbesFor,
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
    expect(report).toEqual({ piExtensions: [], binaries: [], services: [], paths: [] });
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
    setCachedReport("x", { piExtensions: [], binaries: [], services: [], paths: [] }, now);
    expect(getCachedReport("x", now + 1_000)).toEqual({
      piExtensions: [],
      binaries: [],
      services: [],
      paths: [],
    });
  });

  it("returns null after the TTL window", () => {
    const now = 10_000;
    setCachedReport("x", { piExtensions: [], binaries: [], services: [], paths: [] }, now);
    expect(getCachedReport("x", now + 31_000)).toBeNull();
  });
});

// ── paths requirement category (see change: add-apple-tools-imcp-plugin) ──────

describe("probePath", () => {
  it("#E16: existing absolute literal path → satisfied", () => {
    const r = probePath("/Applications/iMCP.app/Contents/MacOS/imcp-server", {
      pathExists: (p) => p === "/Applications/iMCP.app/Contents/MacOS/imcp-server",
    });
    expect(r).toEqual({
      name: "/Applications/iMCP.app/Contents/MacOS/imcp-server",
      satisfied: true,
    });
  });

  it("#E17: non-existent absolute literal path → unsatisfied, name flows to missingRequirements", async () => {
    const report = await runRequirementProbesFor(
      { paths: ["/nope/imcp-server"] },
      { pathExists: () => false },
    );
    expect(report.paths[0]).toEqual({ name: "/nope/imcp-server", satisfied: false });
    expect(missingFromReport(report)).toContain("/nope/imcp-server");
  });

  it("#E18: existing absolute path containing spaces → satisfied (no denylist)", () => {
    const p = "/Applications/My App.app/Contents/MacOS/imcp-server";
    const r = probePath(p, { pathExists: (x) => x === p });
    expect(r.satisfied).toBe(true);
  });

  it("#E19: relative path is not resolved against cwd → unsatisfied", () => {
    let called = false;
    const r = probePath("./imcp-server", {
      pathExists: () => {
        called = true;
        return true;
      },
    });
    expect(r.satisfied).toBe(false);
    expect(called).toBe(false);
  });

  it("#E20: metacharacter path is opaque — no shell, existence check only", () => {
    const p = "/tmp/x; rm -rf / && $(whoami)";
    const seen: string[] = [];
    const r = probePath(p, {
      pathExists: (x) => {
        seen.push(x);
        return false;
      },
    });
    expect(r).toEqual({ name: p, satisfied: false });
    // existence probe received the raw string verbatim; nothing spawned a shell.
    expect(seen).toEqual([p]);
  });

  it("#E21: ${configKey} resolves to an existing absolute path → satisfied, name === resolved value", () => {
    const cfgPath = "/Users/me/Applications/iMCP.app/Contents/MacOS/imcp-server";
    const r = probePath("${imcpServerPath}", {
      configSchemaKeys: ["imcpServerPath"],
      pluginConfig: { imcpServerPath: cfgPath },
      pathExists: (x) => x === cfgPath,
    });
    expect(r).toEqual({ name: cfgPath, satisfied: true });
  });

  it("#E22: ${configKey} at schema default resolves identically to a literal", () => {
    const def = "/Applications/iMCP.app/Contents/MacOS/imcp-server";
    const interpolated = probePath("${imcpServerPath}", {
      configSchemaKeys: ["imcpServerPath"],
      pluginConfig: { imcpServerPath: def },
      pathExists: (x) => x === def,
    });
    const literal = probePath(def, { pathExists: (x) => x === def });
    expect(interpolated).toEqual(literal);
  });

  it("#E23: ${configKey} naming a key absent from configSchema → unsatisfied, no throw, siblings still probed", async () => {
    const report = await runRequirementProbesFor(
      { piExtensions: ["pi-mcp-adapter"], paths: ["${notInSchema}"] },
      {
        configSchemaKeys: ["imcpServerPath"],
        pluginConfig: {},
        listInstalled: async () => [{ name: "pi-mcp-adapter" }],
        pathExists: () => true,
      },
    );
    expect(report.paths[0]).toEqual({ name: "${notInSchema}", satisfied: false });
    // sibling category still probed
    expect(report.piExtensions[0]).toEqual({ name: "pi-mcp-adapter", satisfied: true });
  });

  it("#E24: ${configKey} resolving to a relative path → unsatisfied, no throw", () => {
    const r = probePath("${imcpServerPath}", {
      configSchemaKeys: ["imcpServerPath"],
      pluginConfig: { imcpServerPath: "relative/imcp-server" },
      pathExists: () => true,
    });
    expect(r).toEqual({ name: "${imcpServerPath}", satisfied: false });
  });

  it("#E25: manifest with piExtensions+binaries only → paths === [], missing list byte-identical to baseline", async () => {
    const report = await runRequirementProbesFor(
      { piExtensions: ["foo-ext"], binaries: ["missing-bin"] },
      {
        listInstalled: async () => [],
        toolRegistry: { resolve: () => ({ ok: false }) },
      },
    );
    expect(report.paths).toEqual([]);
    // ordering: piExtensions then binaries, exactly as before paths existed
    expect(missingFromReport(report)).toEqual(["foo-ext", "missing-bin"]);
  });

  it("#E26: manifest with no requires → empty missing list, no throw", async () => {
    const report = await runRequirementProbesFor(undefined, {});
    expect(missingFromReport(report)).toEqual([]);
    expect(report.paths).toEqual([]);
  });
});

describe("paths TTL cache (#P3)", () => {
  it("a second probe inside the cache window performs 0 filesystem stats", async () => {
    let stats = 0;
    const deps = {
      pathExists: (_p: string) => {
        stats++;
        return true;
      },
    };
    const first = await runRequirementProbes(
      { id: "apple-tools", displayName: "A", claims: [], requires: { paths: ["/x/imcp-server"] } },
      deps,
    );
    setCachedReport("apple-tools", first);
    const statsAfterFirst = stats;
    // Second read served from cache — no probe re-run, no new stat.
    const cached = getCachedReport("apple-tools");
    expect(cached).not.toBeNull();
    expect(stats).toBe(statsAfterFirst);
  });
});
