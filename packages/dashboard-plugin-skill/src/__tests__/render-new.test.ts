/**
 * Mode `new` tests — exercise the renderer with synthetic answer sets and
 * snapshot-assert the resulting in-memory tree.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseDeclaration } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-identity.js";
import { afterEach, describe, expect, it } from "vitest";
import { writeProjectId } from "../project-identity.js";
import type { AppScopeAnswers, NewModeAnswers, SlotId } from "../render.js";
import { type InMemorySink, render } from "../render.js";

const ALL_SLOTS: SlotId[] = [
  "sidebar-folder-section",
  "session-card-badge",
  "session-card-action-bar",
  "content-view",
  "content-header-sticky",
  "content-inline-footer",
  "anchored-popover",
  "command-route",
  "settings-section",
  "tool-renderer",
];

function baseAnswers(overrides: Partial<NewModeAnswers> = {}): NewModeAnswers {
  return {
    mode: "new",
    id: "acme",
    displayName: "Acme",
    priority: 100,
    slots: ["settings-section", "tool-renderer"],
    server: true,
    bridge: false,
    configSchema: true,
    outDir: "/virtual/packages/acme-plugin",
    ...overrides,
  };
}

describe("render new — minimal acme", () => {
  const sink = render(baseAnswers()) as InMemorySink;
  const files = Array.from(sink.files.keys()).sort();

  it("writes the expected file set (no bridge)", () => {
    expect(files).toEqual([
      "README.md",
      "configSchema.json",
      "package.json",
      "src/client.tsx",
      "src/server/index.ts",
      "test/index.test.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]);
  });

  it("does NOT write src/bridge/index.ts when bridge=false", () => {
    expect(sink.files.has("src/bridge/index.ts")).toBe(false);
  });

  it("package.json declares pi-dashboard-plugin manifest at top level", () => {
    const pkg = JSON.parse(sink.files.get("package.json")!) as Record<string, unknown>;
    expect(pkg["pi-dashboard-plugin"]).toBeDefined();
    const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown>;
    expect(manifest.id).toBe("acme");
    expect(manifest.requiredApi).toBe("^0.x");
    expect(Array.isArray(manifest.claims)).toBe(true);
  });

  it("package.json adds both SDK deps", () => {
    const pkg = JSON.parse(sink.files.get("package.json")!) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@blackbelt-technology/dashboard-plugin-runtime"]).toBeDefined();
    expect(pkg.dependencies["@blackbelt-technology/pi-dashboard-shared"]).toBeDefined();
  });

  it("client.tsx contains stubs for picked slots", () => {
    const client = sink.files.get("src/client.tsx")!;
    expect(client).toContain("export function Settings");
    expect(client).toContain("export function ToolRenderer");
    // Did NOT include unpicked slot stubs
    expect(client).not.toContain("export function FolderSection");
  });
});

describe("render new — all 10 slots", () => {
  const sink = render(baseAnswers({ slots: ALL_SLOTS })) as InMemorySink;
  const client = sink.files.get("src/client.tsx")!;

  it.each([
    "FolderSection",
    "SessionBadge",
    "SessionActionBar",
    "ContentView",
    "ContentHeader",
    "ContentInlineFooter",
    "AnchoredPopover",
    "Settings",
    "ToolRenderer",
  ])("client.tsx exports %s", (name) => {
    expect(client).toContain(`export function ${name}`);
  });

  it("manifest contains a claim for every slot", () => {
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { claims: Array<{ slot: string }> } };
    const claimedSlots = new Set(pkg["pi-dashboard-plugin"].claims.map((c) => c.slot));
    for (const slot of ALL_SLOTS) {
      expect(claimedSlots.has(slot)).toBe(true);
    }
  });
});

describe("render new — bridge opt-in", () => {
  it("writes src/bridge/index.ts when bridge=true", () => {
    const sink = render(baseAnswers({ bridge: true })) as InMemorySink;
    expect(sink.files.has("src/bridge/index.ts")).toBe(true);
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { bridge?: string } };
    expect(pkg["pi-dashboard-plugin"].bridge).toBe("./src/bridge/index.ts");
  });
});

describe("render new — configSchema opt-out", () => {
  it("does NOT write configSchema.json when configSchema=false", () => {
    const sink = render(baseAnswers({ configSchema: false })) as InMemorySink;
    expect(sink.files.has("configSchema.json")).toBe(false);
    const pkg = JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": { configSchema?: string } };
    expect(pkg["pi-dashboard-plugin"].configSchema).toBeUndefined();
  });
});

describe("render new — validation", () => {
  it("rejects non-kebab id", () => {
    expect(() => render(baseAnswers({ id: "Acme" }))).toThrow(/kebab-case/);
    expect(() => render(baseAnswers({ id: "acme_plugin" }))).toThrow(/kebab-case/);
    expect(() => render(baseAnswers({ id: "1bad" }))).toThrow(/kebab-case/);
  });

  it("rejects empty slots", () => {
    expect(() => render(baseAnswers({ slots: [] }))).toThrow(/at least one slot/);
  });

  it("rejects unknown slot id", () => {
    expect(() => render(baseAnswers({ slots: ["bogus" as SlotId] }))).toThrow(/unknown slot/);
  });

  it("rejects negative priority", () => {
    expect(() => render(baseAnswers({ priority: -1 }))).toThrow(/non-negative/);
  });
});


// ── Embedded app scopes (change: add-project-scoped-apps) ────────────────────

function appSink(appScope: AppScopeAnswers, id = "judo"): InMemorySink {
  return render(baseAnswers({ id, displayName: "Judo Tools", slots: [], appScope })) as InMemorySink;
}
const manifestOf = (sink: InMemorySink) =>
  (JSON.parse(sink.files.get("package.json")!) as { "pi-dashboard-plugin": Record<string, unknown> & { claims: Array<Record<string, unknown>> } })[
    "pi-dashboard-plugin"
  ];

describe("render new — app scopes (E28)", () => {
  it("none: no app files, byte-identical client", () => {
    const withNone = render(baseAnswers({ appScope: { scope: "none" } })) as InMemorySink;
    const without = render(baseAnswers()) as InMemorySink;
    expect(withNone.files.has("src/app/app.tsx")).toBe(false);
    expect(withNone.files.get("src/client.tsx")).toBe(without.files.get("src/client.tsx"));
    expect(withNone.files.get("package.json")).toBe(without.files.get("package.json"));
  });

  it("global: depth-1 content claim, no folder entry, no scope", () => {
    const sink = appSink({ scope: "global" });
    const m = manifestOf(sink);
    expect(m.claims).toEqual([
      { slot: "shell-overlay-route", component: "JudoAppRoute", path: "/judo/*?", depth: 1, presentation: "content" },
    ]);
    expect(m.requiredApi).toBe("^0.x");
    expect(m.projectTypes).toBeUndefined();
    expect(sink.files.get("src/client.tsx")).not.toContain("FolderEntry");
    const route = sink.files.get("src/app/AppRoute.tsx")!;
    expect(route).toContain("<EmbeddedApp");
    expect(route).not.toContain("projectScope");
    expect(route).not.toContain("standaloneUrl");
  });

  it("project-type: projectTypes + folderHasProjectType predicate + projectScope, no standalone", () => {
    const sink = appSink({ scope: "project-type", type: "judo", markers: ["model/*.judo"] });
    const m = manifestOf(sink);
    expect(m.projectTypes).toEqual([{ type: "judo", markers: ["model/*.judo"] }]);
    expect(m.claims).toEqual([
      {
        slot: "shell-overlay-route",
        component: "JudoAppRoute",
        path: "/folder/:encodedCwd/judo/*?",
        depth: 2,
        parentPath: "/folder/:encodedCwd",
        presentation: "content",
      },
      { slot: "sidebar-folder-section", component: "JudoFolderEntry", predicate: "isJudoFolder" },
    ]);
    expect(m.requiredApi).toBe("^0.x");
    const client = sink.files.get("src/client.tsx")!;
    expect(client).toContain('export const isJudoFolder = folderHasProjectType("judo");');
    expect(client).toContain("export function JudoFolderEntry");
    expect(client).toContain("lazy(() => import(\"./app/AppRoute.js\"))");
    const route = sink.files.get("src/app/AppRoute.tsx")!;
    expect(route).toContain('projectScope={{ type: "judo" }}');
    expect(route).not.toContain("standaloneUrl");
    expect([...sink.files.keys()].some((f) => /standalone/i.test(f))).toBe(false);
  });

  it("project-specific: folderHasProjectId predicate and id scope", () => {
    const sink = appSink({ scope: "project-specific", projectId: "acme-erp" }, "acme");
    const client = sink.files.get("src/client.tsx")!;
    expect(client).toContain('export const isAcmeFolder = folderHasProjectId("acme-erp");');
    expect(sink.files.get("src/app/AppRoute.tsx")).toContain('projectScope={{ id: "acme-erp" }}');
    const m = manifestOf(sink);
    expect(m.projectTypes).toBeUndefined();
    expect(m.requiredApi).toBe("^0.x");
  });

  it("an app scope keeps explicit slot claims too", () => {
    const sink = render(baseAnswers({ appScope: { scope: "global" } })) as InMemorySink;
    const slots = manifestOf(sink).claims.map((c) => c.slot);
    expect(slots).toEqual(expect.arrayContaining(["settings-section", "tool-renderer", "shell-overlay-route"]));
  });
});

describe("render new — invalid app scope stops (E29)", () => {
  it("reports every violation and writes nothing (project-type)", () => {
    const sink = new (render(baseAnswers()).constructor as new () => InMemorySink)();
    let message = "";
    try {
      render(baseAnswers({ appScope: { scope: "project-type", type: "Judo!", markers: ["**/x", "../y", "ok.x"] } }), sink);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('type "Judo!"');
    expect(message).toContain('marker "**/x"');
    expect(message).toContain('marker "../y"');
    expect(message).not.toContain('"ok.x"');
    expect(sink.files.size).toBe(0);
  });

  it("rejects a bad project id and a relative folder path together (project-specific)", () => {
    expect(() =>
      render(baseAnswers({ appScope: { scope: "project-specific", projectId: "ACME", folderPath: "rel/dir" } })),
    ).toThrow(/project id "ACME"[\s\S]*folder path "rel\/dir"/);
  });

  it("rejects a display name that could break the generated source", () => {
    expect(() => render(baseAnswers({ displayName: 'Evil"<', appScope: { scope: "global" } }))).toThrow(/display name/);
  });
});

describe("writeProjectId (E30, E31)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const mkFolder = (): string => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pid-")));
    dirs.push(d);
    return d;
  };
  const withFile = (body: string | Buffer): string => {
    const d = mkFolder();
    fs.mkdirSync(path.join(d, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(path.join(d, ".pi", "dashboard", "project.json"), body);
    return d;
  };
  const fileOf = (d: string) => path.join(d, ".pi", "dashboard", "project.json");
  const read = (d: string) => JSON.parse(fs.readFileSync(fileOf(d), "utf8")) as Record<string, unknown>;

  it("creates the file with schemaVersion 1 when absent", () => {
    const d = mkFolder();
    expect(writeProjectId(d, "acme-erp")).toMatchObject({ ok: true, created: true });
    expect(read(d)).toEqual({ schemaVersion: 1, id: "acme-erp" });
    expect(parseDeclaration(fs.readFileSync(fileOf(d), "utf8"))?.id).toBe("acme-erp");
  });

  it("merges the id and keeps other fields", () => {
    const d = withFile(JSON.stringify({ schemaVersion: 1, type: "judo", owner: "x" }));
    expect(writeProjectId(d, "acme-erp")).toMatchObject({ ok: true, created: false, changed: true });
    expect(read(d)).toEqual({ schemaVersion: 1, type: "judo", owner: "x", id: "acme-erp" });
    expect(parseDeclaration(fs.readFileSync(fileOf(d), "utf8"))).toEqual({ id: "acme-erp", type: "judo" });
  });

  it("adds schemaVersion 1 only when absent", () => {
    const d = withFile(JSON.stringify({ type: "judo" }));
    expect(writeProjectId(d, "acme-erp").ok).toBe(true);
    expect(read(d)).toEqual({ schemaVersion: 1, type: "judo", id: "acme-erp" });
  });

  it("is a no-op when the same id is already declared", () => {
    const body = JSON.stringify({ schemaVersion: 1, id: "acme-erp" });
    const d = withFile(body);
    expect(writeProjectId(d, "acme-erp")).toMatchObject({ ok: true, changed: false });
    expect(fs.readFileSync(fileOf(d), "utf8")).toBe(body);
  });

  it.each<[string, () => string, RegExp]>([
    ["schemaVersion 2", () => withFile(JSON.stringify({ schemaVersion: 2 })), /schemaVersion/],
    ["a different id", () => withFile(JSON.stringify({ schemaVersion: 1, id: "legacy" })), /"legacy"/],
    ["an oversized file", () => withFile(Buffer.alloc(65537, 0x20)), /larger/],
    ["invalid JSON", () => withFile("{"), /not valid JSON/],
    ["a JSON array", () => withFile("[]"), /not a JSON object/],
  ])("refuses %s and leaves the file unchanged", (_label, make, reason) => {
    const d = make();
    const before = fs.readFileSync(fileOf(d));
    const out = writeProjectId(d, "acme-erp");
    expect(out.ok).toBe(false);
    expect((out as { reason: string }).reason).toMatch(reason);
    expect(fs.readFileSync(fileOf(d)).equals(before)).toBe(true);
  });

  it("refuses a symlinked .pi", () => {
    const d = mkFolder();
    const outside = mkFolder();
    fs.mkdirSync(path.join(outside, "dashboard"), { recursive: true });
    fs.symlinkSync(outside, path.join(d, ".pi"));
    const out = writeProjectId(d, "acme-erp");
    expect(out).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(outside, "dashboard", "project.json"))).toBe(false);
  });

  it("refuses a symlinked project.json", () => {
    const d = mkFolder();
    const outside = mkFolder();
    fs.writeFileSync(path.join(outside, "p.json"), JSON.stringify({ schemaVersion: 1 }));
    fs.mkdirSync(path.join(d, ".pi", "dashboard"), { recursive: true });
    fs.symlinkSync(path.join(outside, "p.json"), fileOf(d));
    expect(writeProjectId(d, "acme-erp")).toMatchObject({ ok: false });
    expect(fs.readFileSync(path.join(outside, "p.json"), "utf8")).toBe(JSON.stringify({ schemaVersion: 1 }));
  });

  it("E31: a failed rename leaves the original byte-identical and no temp file", () => {
    const body = JSON.stringify({ schemaVersion: 1, owner: "x" });
    const d = withFile(body);
    const out = writeProjectId(d, "acme-erp", {
      rename: () => {
        throw new Error("boom");
      },
    });
    expect(out).toMatchObject({ ok: false });
    expect(fs.readFileSync(fileOf(d), "utf8")).toBe(body);
    expect(fs.readdirSync(path.join(d, ".pi", "dashboard"))).toEqual(["project.json"]);
  });
});
