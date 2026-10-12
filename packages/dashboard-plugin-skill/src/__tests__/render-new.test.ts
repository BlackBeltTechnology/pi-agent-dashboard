/**
 * Mode `new` tests — exercise the renderer with synthetic answer sets and
 * snapshot-assert the resulting in-memory tree.
 */
import { describe, expect, it } from "vitest";
import type { NewModeAnswers, SlotId } from "../render.js";
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
