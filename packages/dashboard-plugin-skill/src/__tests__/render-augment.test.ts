/**
 * Mode `augment` tests — exercise the renderer against a fixture pi-extension
 * package.json on disk, then assert the resulting in-memory tree.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AugmentModeAnswers } from "../render.js";
import { type InMemorySink, render } from "../render.js";

const BASE_PKG = {
  name: "@scope/sample-extension",
  version: "0.1.0",
  description: "Sample pi extension",
  type: "module",
  exports: { "./bridge": "./src/bridge.ts" },
  dependencies: {
    "lodash": "^4.0.0",
    "pi-coding-agent": "^0.70.0",
  },
};

let workdir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "augment-test-"));
  fs.writeFileSync(path.join(workdir, "package.json"), JSON.stringify(BASE_PKG, null, 2));
});

function answers(overrides: Partial<AugmentModeAnswers> = {}): AugmentModeAnswers {
  return {
    mode: "augment",
    outDir: workdir,
    confirmedProposals: [
      {
        file: "src/foo.ts",
        line: 42,
        callsite: "ctx.ui.custom<MyView>(...)",
        mappedSlot: "content-view",
        componentSuggestion: "MyView",
      },
      {
        file: "src/foo.ts",
        line: 80,
        callsite: 'pi.registerTool({ name: "Doit" })',
        mappedSlot: "tool-renderer",
      },
    ],
    addServer: false,
    ...overrides,
  };
}

describe("render augment — minimal", () => {
  it("injects pi-dashboard-plugin manifest at top level", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as Record<string, unknown>;
    expect(pkg["pi-dashboard-plugin"]).toBeDefined();
    const m = pkg["pi-dashboard-plugin"] as Record<string, unknown>;
    expect(m.id).toBe("sample-extension");
    expect(m.requiredApi).toBe("^0.x");
    expect(m.client).toBe("./src/dashboard/client.tsx");
  });

  it("preserves existing dependencies and adds SDK deps in alpha order", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["lodash"]).toBe("^4.0.0");
    expect(pkg.dependencies["pi-coding-agent"]).toBe("^0.70.0");
    expect(pkg.dependencies["@blackbelt-technology/dashboard-plugin-runtime"]).toBeDefined();
    expect(pkg.dependencies["@blackbelt-technology/pi-dashboard-shared"]).toBeDefined();
    expect(Object.keys(pkg.dependencies)).toEqual(Object.keys(pkg.dependencies).slice().sort());
  });

  it("preserves existing exports and adds ./client entry", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { exports: Record<string, string> };
    expect(pkg.exports["./bridge"]).toBe("./src/bridge.ts");
    expect(pkg.exports["./client"]).toBe("./src/dashboard/client.tsx");
  });

  it("scaffolds src/dashboard/client.tsx with stubs for confirmed claims only", () => {
    const sink = render(answers()) as InMemorySink;
    const client = sink.files.get("src/dashboard/client.tsx")!;
    expect(client).toContain("export function ContentView");
    expect(client).toContain("export function ToolRenderer");
    expect(client).not.toContain("export function FolderSection");
  });

  it("does NOT write src/dashboard/server.ts when addServer=false", () => {
    const sink = render(answers({ addServer: false })) as InMemorySink;
    expect(sink.files.has("src/dashboard/server.ts")).toBe(false);
  });

  it("writes src/dashboard/server.ts when addServer=true", () => {
    const sink = render(answers({ addServer: true })) as InMemorySink;
    expect(sink.files.has("src/dashboard/server.ts")).toBe(true);
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { server?: string } };
    expect(pkg["pi-dashboard-plugin"].server).toBe("./src/dashboard/server.ts");
  });

  it("does not write any pre-existing source file", () => {
    // Renderer only writes to the sink; we can also verify the only files are the additive ones.
    const sink = render(answers()) as InMemorySink;
    const written = Array.from(sink.files.keys()).sort();
    expect(written).toEqual(["package.json", "src/dashboard/client.tsx"]);
  });
});

describe("render augment — forward-compat contract (items 1-5)", () => {
  it("(1) manifest field at top level of package.json", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(pkg, "pi-dashboard-plugin")).toBe(true);
    // Not nested under pi
    const piField = (pkg["pi"] as Record<string, unknown> | undefined) ?? {};
    expect(piField["pi-dashboard-plugin"]).toBeUndefined();
  });

  it("(2) all manifest paths are package-relative, no leading / or escaping ..", () => {
    const sink = render(answers({ addServer: true })) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": Record<string, unknown> };
    const m = pkg["pi-dashboard-plugin"];
    for (const key of ["client", "server", "bridge", "configSchema"]) {
      const value = m[key];
      if (value === undefined) continue;
      expect(typeof value).toBe("string");
      const v = value as string;
      expect(v.startsWith("/")).toBe(false);
      expect(v.includes("../")).toBe(false);
      expect(v.startsWith("./")).toBe(true);
    }
  });

  it("(3) does not introduce workspace:* deps", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { dependencies: Record<string, string> };
    for (const v of Object.values(pkg.dependencies)) {
      expect(v.startsWith("workspace:")).toBe(false);
    }
  });

  it("(4) exports declares a subpath matching every manifest path", () => {
    const sink = render(answers({ addServer: true })) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as {
      exports: Record<string, string>;
      "pi-dashboard-plugin": Record<string, string>;
    };
    expect(pkg.exports["./client"]).toBe(pkg["pi-dashboard-plugin"].client);
    expect(pkg.exports["./server"]).toBe(pkg["pi-dashboard-plugin"].server);
  });

  it("(5) manifest declares requiredApi as a non-empty string", () => {
    const sink = render(answers()) as InMemorySink;
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { requiredApi: string } };
    expect(typeof pkg["pi-dashboard-plugin"].requiredApi).toBe("string");
    expect(pkg["pi-dashboard-plugin"].requiredApi.length).toBeGreaterThan(0);
  });
});

describe("render new — forward-compat contract (mode new also satisfies 1-5)", () => {
  it("new-mode output also satisfies all 5 items", async () => {
    const { render: r, InMemorySink: Mem } = await import("../render.js");
    const sink = r({
      mode: "new",
      id: "fwd",
      displayName: "Forward",
      priority: 100,
      slots: ["session-card-badge"],
      server: true,
      bridge: true,
      configSchema: true,
      outDir: "/virtual",
    }) as InstanceType<typeof Mem>;
    const pkg = JSON.parse(sink.files.get("package.json")!) as {
      exports: Record<string, string>;
      dependencies: Record<string, string>;
      "pi-dashboard-plugin": Record<string, string>;
    };
    // (1)
    expect(pkg["pi-dashboard-plugin"].id).toBe("fwd");
    // (2)
    for (const k of ["client", "server", "bridge", "configSchema"]) {
      const v = pkg["pi-dashboard-plugin"][k];
      if (!v) continue;
      expect(v.startsWith("./")).toBe(true);
      expect(v.includes("../")).toBe(false);
    }
    // (3)
    for (const v of Object.values(pkg.dependencies)) expect(v.startsWith("workspace:")).toBe(false);
    // (4)
    expect(pkg.exports["./client"]).toBe(pkg["pi-dashboard-plugin"].client);
    expect(pkg.exports["./server"]).toBe(pkg["pi-dashboard-plugin"].server);
    expect(pkg.exports["./bridge"]).toBe(pkg["pi-dashboard-plugin"].bridge);
    // (5)
    expect(pkg["pi-dashboard-plugin"].requiredApi).toBeTruthy();
  });
});
