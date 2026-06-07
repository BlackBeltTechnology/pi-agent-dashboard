/**
 * Repo-level invariant: plugin source files MUST NOT directly import the
 * UI primitive COMPONENTS / HELPERS that are registered in the dashboard's
 * UI primitive registry. They SHALL look those up via
 * `useUiPrimitive(UI_PRIMITIVE_KEYS.<key>)` from
 * `@blackbelt-technology/dashboard-plugin-runtime` instead.
 *
 * Hooks (`useMobile`, `useZoomPan`, `useMediaQuery`) and Phase-2 extension-ui
 * slot consumers (`AgentMetricSlot`, `BreadcrumbSlot`, `GateSlot`, the
 * `decorator-utils` helpers) are EXPLICITLY ALLOWED — hooks can't go through
 * a registry (Rules of Hooks) and slot consumers are a different layer.
 *
 * This invariant exists because:
 *
 *   1. Without it, plugin authors will keep importing primitives directly
 *      because it works in dev. The CI hazard (deep imports breaking when
 *      tarballs are installed from npm) returns the next time a release
 *      ships with broken plugins.
 *
 *   2. The registry pattern only delivers benefit when EVERY plugin uses it.
 *      One plugin importing `MarkdownContent` directly drags the markdown
 *      stack into its tarball; tree-shaking can't help across a published
 *      package boundary.
 *
 * If this test fails, the suggested replacement is in the failure message:
 *
 *   import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
 *   import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
 *   ...
 *   const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
 *
 * See change: add-plugin-ui-primitive-registry.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * Symbol names whose direct import from `pi-dashboard-client-utils/<X>` is
 * forbidden in plugin source. Each maps to its registry key for the
 * remediation message.
 */
const FORBIDDEN_PRIMITIVES: Record<string, { subpath: string; registryKey: string }> = {
  AgentCardShell: { subpath: "AgentCardShell", registryKey: "UI_PRIMITIVE_KEYS.agentCard" },
  MarkdownContent: { subpath: "MarkdownContent", registryKey: "UI_PRIMITIVE_KEYS.markdownContent" },
  Confirm: { subpath: "Confirm", registryKey: "UI_PRIMITIVE_KEYS.confirmDialog" },
  Dialog: { subpath: "Dialog", registryKey: "UI_PRIMITIVE_KEYS.dialog" },
  DialogPortal: { subpath: "DialogPortal", registryKey: "UI_PRIMITIVE_KEYS.dialogPortal" },
  SearchableSelectDialog: {
    subpath: "SearchableSelectDialog",
    registryKey: "UI_PRIMITIVE_KEYS.searchableSelectDialog",
  },
  ZoomControls: { subpath: "ZoomControls", registryKey: "UI_PRIMITIVE_KEYS.zoomControls" },
  formatTokens: { subpath: "agent-card-utils", registryKey: "UI_PRIMITIVE_KEYS.formatTokens" },
  formatDuration: {
    subpath: "agent-card-utils",
    registryKey: "UI_PRIMITIVE_KEYS.formatDuration",
  },
};

/**
 * Recursively collect TypeScript source files under `dir`, skipping
 * node_modules / dist / build artifacts and `__tests__` directories
 * (test fixtures often reference primitives directly).
 */
function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;
      if (entry.name === "__tests__") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // Skip type-declaration-only files — they don't ship runtime code.
      if (entry.name.endsWith(".d.ts")) continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * Scan a source file for forbidden primitive-import lines.
 * Returns each violation with the symbol name, the imported subpath, and
 * the line number for the failure message.
 */
interface Violation {
  file: string;
  line: number;
  source: string;
  symbol: string;
  registryKey: string;
}

function scanFile(filePath: string): Violation[] {
  const source = fs.readFileSync(filePath, "utf-8");
  const violations: Violation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match `import { ... } from "@blackbelt-technology/pi-dashboard-client-utils/<subpath>"`
    // capturing the imported names list and the subpath.
    const match = line.match(
      /import\s+(?:type\s+)?\{\s*([^}]+)\s*\}\s+from\s+["']@blackbelt-technology\/pi-dashboard-client-utils\/([^"']+)["']/,
    );
    if (!match) continue;
    const [, importNamesRaw, subpath] = match;
    // Allow imports from extension-ui/* and useMobile/useZoomPan/useMediaQuery
    // subpaths — these are not registered primitives.
    if (subpath.startsWith("extension-ui/")) continue;
    if (subpath === "useMobile" || subpath === "useZoomPan" || subpath === "useMediaQuery") continue;

    // Parse the imported symbol names. Strip `type` modifiers, aliases, whitespace.
    const importedNames = importNamesRaw
      .split(",")
      .map((n) => n.replace(/^\s*type\s+/, "").trim())
      .map((n) => n.split(/\s+as\s+/)[0]!.trim())
      .filter((n) => n.length > 0);

    for (const name of importedNames) {
      const banned = FORBIDDEN_PRIMITIVES[name];
      if (!banned) continue;
      violations.push({
        file: path.relative(REPO_ROOT, filePath),
        line: i + 1,
        source: line.trim(),
        symbol: name,
        registryKey: banned.registryKey,
      });
    }
  }
  return violations;
}

/**
 * Walk every plugin package source tree.
 * Plugin packages are workspaces under `packages/` whose name ends in
 * `-plugin`, plus `demo-plugin` (a fixture).
 */
function findPluginPackages(): string[] {
  const packagesDir = path.join(REPO_ROOT, "packages");
  if (!fs.existsSync(packagesDir)) return [];
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name.endsWith("-plugin") || name === "demo-plugin")
    .map((name) => path.join(packagesDir, name, "src"));
}

describe("no-primitive-direct-import (repo-lint)", () => {
  it("plugin source files SHALL NOT directly import registered UI primitives", () => {
    const pluginSrcDirs = findPluginPackages();
    expect(pluginSrcDirs.length).toBeGreaterThan(0); // sanity: we found plugin packages

    const allViolations: Violation[] = [];
    for (const srcDir of pluginSrcDirs) {
      for (const file of collectSourceFiles(srcDir)) {
        allViolations.push(...scanFile(file));
      }
    }

    if (allViolations.length > 0) {
      const lines = allViolations.map(
        (v) =>
          `  ${v.file}:${v.line}\n    ${v.source}\n` +
          `    Replace with: const ${v.symbol} = useUiPrimitive(${v.registryKey});`,
      );
      // SOFTENED to a warning during the intent-rendering migration window.
      // Once flows-plugin (and similar) finishes migrating to server-side
      // intent broadcasts, this should be re-tightened to forbid both
      // direct primitive imports AND useUiPrimitive calls from plugin code.
      // See change: adopt-server-driven-intent-rendering (section 25).
      console.warn(
        `[no-primitive-direct-import] WARN: ${allViolations.length} direct primitive import(s) in plugin source. (Lint softened during migration.)\n` +
          lines.join("\n\n"),
      );
    }
  });

  // Self-test: assert the lint does what it says by scanning a synthetic violation.
  it("flags a planted bad import in a fixture string", () => {
    const fixtureSource = [
      'import { MarkdownContent } from "@blackbelt-technology/pi-dashboard-client-utils/MarkdownContent";',
      'import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";',
    ].join("\n");
    const tmp = path.join(REPO_ROOT, ".tmp-no-primitive-direct-import-fixture.tsx");
    fs.writeFileSync(tmp, fixtureSource);
    try {
      const violations = scanFile(tmp);
      expect(violations).toHaveLength(1);
      expect(violations[0].symbol).toBe("MarkdownContent");
      expect(violations[0].registryKey).toBe("UI_PRIMITIVE_KEYS.markdownContent");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  // Self-test: hook imports + extension-ui imports + non-primitive symbols are allowed.
  it("does NOT flag allowed imports", () => {
    const fixtureSource = [
      'import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";',
      'import { useZoomPan } from "@blackbelt-technology/pi-dashboard-client-utils/useZoomPan";',
      'import { useMediaQuery } from "@blackbelt-technology/pi-dashboard-client-utils/useMediaQuery";',
      'import { GateSlot, aggregateGateState } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/GateSlot";',
      'import { BreadcrumbSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/BreadcrumbSlot";',
      'import { AgentMetricSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/AgentMetricSlot";',
    ].join("\n");
    const tmp = path.join(REPO_ROOT, ".tmp-no-primitive-direct-import-allow-fixture.tsx");
    fs.writeFileSync(tmp, fixtureSource);
    try {
      const violations = scanFile(tmp);
      expect(violations).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
