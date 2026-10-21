/**
 * Tests for the Vite plugin's predicate emission and build-time validation.
 *
 * Companion to vite-plugin.test.ts; isolates the predicate-emission concerns
 * introduced by change `complete-flows-plugin-migration`. Covers:
 *
 *   1. predicate names emitted as named imports + as `predicate:` field on
 *      the inline ClaimEntry literal;
 *   2. typo in a manifest's predicate name fails the build with a clear,
 *      caller-actionable error (plugin id, slot, missing name, entry path,
 *      list of actually-exported names);
 *   3. typo in a manifest's component name fails the build identically;
 *   4. claim with no predicate emits no predicate field (no churn for the
 *      common case of no-predicate claims).
 *
 * The validation only runs when the resolved client entry is readable;
 * unreadable entries are a soft-skip. The predicate-emission test cases
 * write real source files at the resolved entry path so the validator
 * actually runs against them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache } from "../server/loader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-plugin-predicate-test-"));
  clearDiscoveryCache();
  fs.mkdirSync(path.join(tmpDir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
});

/**
 * Write a fake plugin package: package.json + a client entry source file
 * exporting the named symbols the test expects.
 */
function writePluginWithSource(
  name: string,
  manifest: Record<string, unknown>,
  clientSource: string,
  clientRelPath = "src/client/index.tsx",
) {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  const fullManifest = { ...manifest, client: `./${clientRelPath}` };
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, "pi-dashboard-plugin": fullManifest }),
  );
  const entryPath = path.join(pkgDir, clientRelPath);
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, clientSource, "utf-8");
}

async function invokePlugin(): Promise<string> {
  const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
  const plugin = viteDashboardPluginsPlugin(tmpDir);
  await (plugin as { buildStart?: () => void }).buildStart?.();
  const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
  return fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
}

describe("viteDashboardPluginsPlugin predicate emission", () => {
  it("emits predicate as a named import and as `predicate:` on the ClaimEntry literal", async () => {
    writePluginWithSource(
      "flows-plugin",
      {
        id: "flows",
        displayName: "Flows",
        priority: 100,
        claims: [
          { slot: "session-card-badge", component: "FlowActivityBadge", predicate: "hasActiveFlow" },
        ],
      },
      `
export function FlowActivityBadge() { return null; }
export function hasActiveFlow(session) { return Boolean(session && session.flowState); }
`,
    );

    const content = await invokePlugin();

    // Both names imported in a single named-import line from the plugin's client entry.
    expect(content).toMatch(/import \{[^}]*\bFlowActivityBadge\b[^}]*\bhasActiveFlow\b[^}]*\}/);
    expect(content).not.toContain("import * as");

    // Inline ClaimEntry literal carries both `Component:` and `predicate:` refs.
    expect(content).toMatch(
      /\{ pluginId: "flows"[^}]*Component: FlowActivityBadge[^}]*predicate: hasActiveFlow[^}]*\}/,
    );
  });

  it("does NOT emit a predicate field when the manifest claim has no predicate", async () => {
    writePluginWithSource(
      "actions-plugin",
      {
        id: "actions",
        displayName: "Actions",
        priority: 100,
        claims: [
          { slot: "session-card-action-bar", component: "SessionFlowActions" },
        ],
      },
      `
export function SessionFlowActions() { return null; }
`,
    );

    const content = await invokePlugin();

    // Component is imported and emitted on the literal.
    expect(content).toContain("import { SessionFlowActions }");
    expect(content).toMatch(/\{ pluginId: "actions"[^}]*Component: SessionFlowActions[^}]*\}/);

    // The literal for THIS claim does not contain `predicate:`.
    // We extract the line containing pluginId "actions" and assert.
    const claimLine = content.split("\n").find(l => l.includes('"actions"') && l.includes("Component:"));
    expect(claimLine).toBeTruthy();
    expect(claimLine).not.toContain("predicate:");
  });

  it("fails the build when a claim references a predicate not exported by the client entry (typo)", async () => {
    writePluginWithSource(
      "flows-plugin",
      {
        id: "flows",
        displayName: "Flows",
        priority: 100,
        claims: [
          { slot: "session-card-badge", component: "FlowActivityBadge", predicate: "hasActiveFlw" },
        ],
      },
      // Intentionally exports the correct name to make the typo caller-side.
      `
export function FlowActivityBadge() { return null; }
export function hasActiveFlow(session) { return Boolean(session); }
`,
    );

    await expect(invokePlugin()).rejects.toThrow(
      /Plugin "flows".*slot "session-card-badge".*predicate "hasActiveFlw"/s,
    );
    // Error includes the entry path and the actually-exported names so the
    // user knows what to type instead.
    await expect(invokePlugin()).rejects.toThrow(/Exported names: .*FlowActivityBadge/);
    await expect(invokePlugin()).rejects.toThrow(/Exported names: .*hasActiveFlow/);
  });

  it("fails the build when a claim references a component not exported by the client entry (typo)", async () => {
    writePluginWithSource(
      "badge-plugin",
      {
        id: "badge",
        displayName: "Badge",
        priority: 100,
        claims: [
          { slot: "session-card-badge", component: "FlwoBadge" },
        ],
      },
      `
export function FlowBadge() { return null; }
`,
    );

    await expect(invokePlugin()).rejects.toThrow(
      /Plugin "badge".*slot "session-card-badge".*component "FlwoBadge"/s,
    );
    await expect(invokePlugin()).rejects.toThrow(/Exported names: .*FlowBadge/);
  });

  it("soft-skips validation when the client entry source is unreadable", async () => {
    // Simulate a plugin whose client entry path resolves but has no source file
    // (e.g. a published-only dist path during early bootstrap). The plugin's
    // build should NOT crash from the validation pathway; the existing build
    // pipeline surfaces the missing file separately.
    const pkgDir = path.join(tmpDir, "packages", "ghost-plugin");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({
        name: "ghost-plugin",
        "pi-dashboard-plugin": {
          id: "ghost",
          displayName: "Ghost",
          priority: 100,
          client: "./dist/client/index.js", // not on disk
          claims: [
            { slot: "session-card-badge", component: "MissingComponent", predicate: "missingPredicate" },
          ],
        },
      }),
    );

    // Should not throw; the named-import line is still emitted.
    const content = await invokePlugin();
    expect(content).toMatch(/import \{[^}]*MissingComponent[^}]*missingPredicate[^}]*\}/);
  });

  it("deduplicates a name used as both component and predicate across claims", async () => {
    writePluginWithSource(
      "multi-plugin",
      {
        id: "multi",
        displayName: "Multi",
        priority: 100,
        claims: [
          { slot: "session-card-badge", component: "FlowActivityBadge", predicate: "hasActiveFlow" },
          { slot: "content-header-sticky", component: "FlowDashboard", predicate: "hasActiveFlow" },
        ],
      },
      `
export function FlowActivityBadge() { return null; }
export function FlowDashboard() { return null; }
export function hasActiveFlow(session) { return Boolean(session); }
`,
    );

    const content = await invokePlugin();

    // hasActiveFlow appears exactly once in the named-import list.
    const importLine = content.split("\n").find(l => l.includes("hasActiveFlow") && l.includes("import"));
    expect(importLine).toBeTruthy();
    const occurrences = importLine!.match(/\bhasActiveFlow\b/g);
    expect(occurrences?.length).toBe(1);
  });
});


// Declarative reducer registration + tool-renderer row fields in the generated
// registry (design D5 items 6-7). See change: decouple-plugins-from-core (4.2, 4.5).
describe("viteDashboardPluginsPlugin reducer exports + tool-renderer claim fields", () => {
  const pluginSource = `
    export const sessionEventReducer = { eventTypes: ["sub_*"], reduce: (s) => s };
    export const toolRowFinalizers = [{ toolName: "Agent" }];
    export function isPending() { return true; }
    export function AgentCard() { return null; }
  `;

  it("carries sessionEventReducer / toolRowFinalizers exports into the registry entry", async () => {
    writePluginWithSource(
      "sub-plugin",
      { id: "sub", displayName: "Sub", priority: 100, claims: [{ slot: "tool-renderer", toolName: "Agent", component: "AgentCard" }] },
      pluginSource,
    );
    const out = await invokePlugin();
    expect(out).toMatch(/sessionEventReducer as sub_sessionEventReducer/);
    expect(out).toMatch(/toolRowFinalizers as sub_toolRowFinalizers/);
    expect(out).toMatch(/sessionEventReducer: sub_sessionEventReducer,/);
    expect(out).toMatch(/toolRowFinalizers: sub_toolRowFinalizers,/);
  });

  it("a plugin without those exports gets no reducer fields", async () => {
    writePluginWithSource(
      "plain-plugin",
      { id: "plain", displayName: "Plain", priority: 100, claims: [{ slot: "tool-renderer", toolName: "x", component: "AgentCard" }] },
      "export function AgentCard() { return null; }",
    );
    const out = await invokePlugin();
    expect(out).not.toMatch(/plain_sessionEventReducer/);
    expect(out).not.toMatch(/plain_toolRowFinalizers/);
  });

  it("emits expandWhileRunning and resultPending (as a named import) on the claim literal", async () => {
    writePluginWithSource(
      "sub-plugin",
      {
        id: "sub",
        displayName: "Sub",
        priority: 100,
        claims: [{ slot: "tool-renderer", toolName: "Agent", component: "AgentCard", expandWhileRunning: true, resultPending: "isPending" }],
      },
      pluginSource,
    );
    const out = await invokePlugin();
    expect(out).toMatch(/import \{[^}]*\bisPending\b[^}]*\} from/);
    expect(out).toMatch(/toolName: "Agent", expandWhileRunning: true, Component: AgentCard, resultPending: isPending/);
  });

  it("fails the build when resultPending names an export the entry lacks", async () => {
    writePluginWithSource(
      "sub-plugin",
      {
        id: "sub",
        displayName: "Sub",
        priority: 100,
        claims: [{ slot: "tool-renderer", toolName: "Agent", component: "AgentCard", resultPending: "nope" }],
      },
      pluginSource,
    );
    await expect(invokePlugin()).rejects.toThrow(/resultPending "nope"/);
  });
});
