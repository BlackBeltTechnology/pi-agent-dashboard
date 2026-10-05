/**
 * `isRadiusOverridden()` — models.json custom-gateway Radius detection.
 * test-plan #E2 #E3 #E4 #E6 #X2 #E19.
 *
 * See change: add-radius-provider-login (D2).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetRadiusOverrideCacheForTests,
  applyRadiusOverride,
  isRadiusOverridden,
  setAgentDirSource,
} from "../auth/radius-override.js";

let dir: string;
const write = (content: string) => fs.writeFileSync(path.join(dir, "models.json"), content);
const radius = (baseUrl: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ providers: { radius: { oauth: "radius", baseUrl, ...extra } } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "radius-override-"));
  setAgentDirSource(() => dir);
});
afterEach(() => {
  vi.useRealTimers();
  setAgentDirSource(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("override predicate decision table (E2)", () => {
  const cases: Array<[string, () => void, boolean]> = [
    ["a: custom gateway /v1", () => write(radius("https://gw.example.com/v1")), true],
    ["b: default gateway /v1", () => write(radius("https://radius.pi.dev/v1")), false],
    ["c: scheme-less custom host", () => write(radius("gw.example.com")), true],
    ["d: scheme-less default host with slash", () => write(radius("radius.pi.dev/")), false],
    [
      "e: no oauth",
      () => write(JSON.stringify({ providers: { radius: { baseUrl: "https://gw.example.com" } } })),
      false,
    ],
    [
      "f: other id with oauth radius",
      () =>
        write(
          JSON.stringify({
            providers: { other: { oauth: "radius", baseUrl: "https://gw.example.com" } },
          }),
        ),
      false,
    ],
    ["g: providers null", () => write(JSON.stringify({ providers: null })), false],
    ["h: no file", () => undefined, false],
    ["i: empty baseUrl", () => write(radius("")), false],
  ];
  for (const [name, setup, expected] of cases) {
    it(name, () => {
      setup();
      expect(isRadiusOverridden()).toBe(expected);
    });
  }
});

describe("pi parse parity (E3)", () => {
  const url = "https://gw.example.com/v1";
  it("leading BOM", () => {
    write(`\uFEFF${radius(url)}`);
    expect(isRadiusOverridden()).toBe(true);
  });
  it("// line comment", () => {
    write(`// c\n${radius(url)}`);
    expect(isRadiusOverridden()).toBe(true);
  });
  it("trailing comma", () => {
    write('{"providers":{"radius":{"oauth":"radius","baseUrl":"https://gw.example.com",},},}');
    expect(isRadiusOverridden()).toBe(true);
  });
  it("block comment is NOT stripped (pi does not either) → parse error → false", () => {
    write(`/* c */${radius(url)}`);
    expect(isRadiusOverridden()).toBe(false);
  });
  it("schema-invalid extra field still hides", () => {
    write(radius(url, { models: 5 }));
    expect(isRadiusOverridden()).toBe(true);
  });
});

describe("1 s cache (E6)", () => {
  it("serves the memo until 1 s, then re-reads", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    write(radius("https://gw.example.com"));
    expect(isRadiusOverridden()).toBe(true);
    fs.rmSync(path.join(dir, "models.json"));
    vi.setSystemTime(900);
    expect(isRadiusOverridden()).toBe(true);
    vi.setSystemTime(1100);
    expect(isRadiusOverridden()).toBe(false);
  });
});

describe("unreadable models.json (X2)", () => {
  it("a read error is no override, never a throw", () => {
    write(radius("https://gw.example.com"));
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    try {
      _resetRadiusOverrideCacheForTests();
      expect(() => isRadiusOverridden()).not.toThrow();
      expect(isRadiusOverridden()).toBe(false);
      expect(applyRadiusOverride([{ id: "radius" }])).toEqual([{ id: "radius" }]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("applyRadiusOverride", () => {
  it("drops only radius while overridden", () => {
    write(radius("https://gw.example.com"));
    expect(applyRadiusOverride([{ id: "radius" }, { id: "xai" }])).toEqual([{ id: "xai" }]);
  });
});

describe("no pi-ai / pi deep-path import in runtime modules (E19)", () => {
  it.each(["radius-override.ts", "radius-mcp.ts", "provider-auth-registry.ts"])("%s", (file) => {
    const p = path.resolve(__dirname, "../auth", file);
    if (!fs.existsSync(p)) return; // radius-mcp.ts lands with section 4
    const src = fs.readFileSync(p, "utf8");
    expect(src).not.toMatch(/from\s+["']@earendil-works\/pi-ai/);
    expect(src).not.toMatch(/pi-coding-agent\/dist\//);
  });
});

describe("drift guard against the real ModelRuntime (E4)", () => {
  const fixtures: Record<string, string> = {
    custom: radius("https://gw.example.com/v1"),
    defaultGw: radius("https://radius.pi.dev/v1"),
    schemeless: radius("gw.example.com"),
    schemelessDefault: radius("radius.pi.dev/"),
    noOauth: JSON.stringify({ providers: { radius: { baseUrl: "https://gw.example.com", api: "openai-completions" } } }),
    bom: `\uFEFF${radius("https://gw.example.com")}`,
    lineComment: `// c\n${radius("https://gw.example.com")}`,
    trailingComma: '{"providers":{"radius":{"oauth":"radius","baseUrl":"https://gw.example.com",},},}',
    providersNull: JSON.stringify({ providers: null }),
  };

  for (const [name, content] of Object.entries(fixtures)) {
    it(`predicate === runtime replaced the built-in: ${name}`, async () => {
      write(content);
      const prev = process.env.PI_CODING_AGENT_DIR;
      process.env.PI_CODING_AGENT_DIR = dir;
      try {
        const mod = (await import("@earendil-works/pi-coding-agent")) as unknown as {
          ModelRuntime: { create(o: unknown): Promise<{ getModels(id?: string): readonly unknown[] }> };
          getAgentDir: () => string;
        };
        setAgentDirSource(mod.getAgentDir);
        _resetRadiusOverrideCacheForTests();
        const emptyStore = {
          read: async () => undefined,
          list: async () => [],
          modify: async () => undefined,
          delete: async () => undefined,
        };
        const runtime = await mod.ModelRuntime.create({
          credentials: emptyStore,
          modelsPath: path.join(dir, "models.json"),
          refreshOnCreate: false,
          allowModelNetwork: false,
        });
        const replaced = runtime.getModels("radius").length === 0;
        expect(isRadiusOverridden()).toBe(replaced);
      } finally {
        if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = prev;
      }
    });
  }
});
