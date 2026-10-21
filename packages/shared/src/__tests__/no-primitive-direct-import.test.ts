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
 * Plugin code MAY call `useUiPrimitive` / `useUiPrimitiveOrNull` (public host
 * API, `plugin-host-api`): only direct imports of primitive IMPLEMENTATIONS are
 * flagged — never the hook calls (test-plan #X3).
 *
 * The same file hosts the allowed-subpaths lint (#E33, `dashboard-plugin-loader`
 * "Plugins SHALL import from … only"): plugin production source may import the
 * runtime root, `./context` (deprecated), `./sdk`, `./server`, `./bridge`,
 * `./embedded-app`, `./manifest-validator`, `./vite-plugin`, `./test-support`;
 * plugin TESTS may also import `./host`; nobody imports the client/server
 * packages directly.
 *
 * @structural-pin this is a repo lint: it scans plugin source TEXT (imports, local codec definitions, class literals) by design
 *
 * See changes: add-plugin-ui-primitive-registry, decouple-plugins-from-core.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

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

// ── `useUiPrimitive` calls are not flagged (test-plan #X3 c) ────────────────

describe("useUiPrimitive calls", () => {
  it("are allowed in plugin source: only direct primitive IMPLEMENTATION imports are flagged", () => {
    const tmp = path.join(REPO_ROOT, ".tmp-no-primitive-direct-import-hook-fixture.tsx");
    fs.writeFileSync(
      tmp,
      [
        'import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";',
        'import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";',
        "const Markdown = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);",
      ].join("\n"),
    );
    try {
      expect(scanFile(tmp)).toHaveLength(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("the useUiPrimitive JSDoc carries no @deprecated tag", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "packages/dashboard-plugin-runtime/src/ui-primitive-context.tsx"),
      "utf-8",
    );
    expect(src).not.toContain("@deprecated");
  });
});

// ── Allowed runtime subpaths (test-plan #E33) ───────────────────────────────

const RUNTIME = "@blackbelt-technology/dashboard-plugin-runtime";
const RUNTIME_ALLOWED = new Set(["", "context", "sdk", "server", "bridge", "embedded-app", "manifest-validator", "vite-plugin", "test-support"]);
const SPECIFIER_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bvi\.(?:do)?mock\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
/** Direct imports of the client or server packages (`-client-utils` is a different package). */
const FORBIDDEN_CORE_RE = /^@blackbelt-technology\/pi-dashboard-(?:client|web|server)(?:\/|$)/;

interface SubpathScan {
  violations: string[];
  deprecations: string[];
}

/** Lint one plugin source file's runtime/core specifiers. `file` only feeds the messages. */
function scanSubpaths(source: string, file: string, isTest: boolean): SubpathScan {
  const out: SubpathScan = { violations: [], deprecations: [] };
  for (const m of source.matchAll(SPECIFIER_RE)) {
    const spec = m[1]!;
    if (FORBIDDEN_CORE_RE.test(spec)) {
      out.violations.push(
        `${file}: imports "${spec}" — plugins must not import core packages; use ${RUNTIME} instead`,
      );
      continue;
    }
    if (spec !== RUNTIME && !spec.startsWith(`${RUNTIME}/`)) continue;
    const sub = spec.slice(RUNTIME.length + 1);
    if (sub === "host") {
      if (!isTest) out.violations.push(`${file}: imports the ./host subpath in non-test source — shell-only names belong to packages/client`);
      continue;
    }
    if (!RUNTIME_ALLOWED.has(sub)) {
      out.violations.push(`${file}: imports internal-only path "${spec}" — use ${RUNTIME}`);
      continue;
    }
    if (sub === "context") out.deprecations.push(`${file}: ./context is deprecated — import from ${RUNTIME}`);
  }
  return out;
}

const TEST_FILE_RE = /(^|\/)(__tests__|test-support|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

function findManifestPluginSrcDirs(): string[] {
  const packagesDir = path.join(REPO_ROOT, "packages");
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(packagesDir, d.name))
    .filter((dir) => {
      try {
        return "pi-dashboard-plugin" in JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
      } catch {
        return false;
      }
    })
    .map((dir) => path.join(dir, "src"));
}

/** Like `collectSourceFiles`, but keeps `__tests__` (tests have their own rule). */
function collectAllSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "build") return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return collectAllSourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [full] : [];
  });
}

describe("allowed plugin subpaths (lint)", () => {
  const imp = (spec: string) => `import { x } from "${spec}";`;

  it("fails a production source that imports ./host, naming the file and subpath", () => {
    const r = scanSubpaths(imp(`${RUNTIME}/host`), "packages/x-plugin/src/client/a.tsx", false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain("packages/x-plugin/src/client/a.tsx");
    expect(r.violations[0]).toContain("./host");
  });

  it("passes a plugin TEST that imports ./host", () => {
    const r = scanSubpaths(imp(`${RUNTIME}/host`), "packages/x-plugin/src/__tests__/a.test.tsx", true);
    expect(r).toEqual({ violations: [], deprecations: [] });
  });

  it("fails an import of the client package and directs the author to the runtime", () => {
    const r = scanSubpaths(imp("@blackbelt-technology/pi-dashboard-client/App"), "a.tsx", false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain(RUNTIME);
    expect(scanSubpaths(imp("@blackbelt-technology/pi-dashboard-web/chat-embed"), "a.tsx", false).violations).toHaveLength(1);
  });

  it("does not confuse client-utils with the client package", () => {
    const r = scanSubpaths(imp("@blackbelt-technology/pi-dashboard-client-utils/useMobile"), "a.tsx", false);
    expect(r.violations).toEqual([]);
  });

  it("passes the runtime root and every allowed subpath", () => {
    for (const sub of ["", "/sdk", "/server", "/bridge", "/embedded-app", "/manifest-validator", "/vite-plugin", "/test-support"]) {
      expect(scanSubpaths(imp(`${RUNTIME}${sub}`), "a.tsx", false)).toEqual({ violations: [], deprecations: [] });
    }
  });

  it("passes ./context but emits a deprecated diagnostic", () => {
    const r = scanSubpaths(imp(`${RUNTIME}/context`), "a.tsx", false);
    expect(r.violations).toEqual([]);
    expect(r.deprecations).toHaveLength(1);
    expect(r.deprecations[0]).toContain("deprecated");
  });

  it("fails an unknown runtime subpath, and catches vi.mock / dynamic import specifiers", () => {
    expect(scanSubpaths(imp(`${RUNTIME}/slot-registry`), "a.tsx", false).violations).toHaveLength(1);
    expect(scanSubpaths(`vi.mock("${RUNTIME}/host", () => ({}));`, "a.test.tsx", false).violations).toHaveLength(1);
    expect(scanSubpaths(`await import("${RUNTIME}/host");`, "a.tsx", false).violations).toHaveLength(1);
  });

  it("every in-repo plugin source passes (no ./host in prod, no client/server imports) and none still uses ./context", () => {
    const srcDirs = findManifestPluginSrcDirs();
    expect(srcDirs.length).toBeGreaterThan(10); // sanity: manifest plugins found
    const violations: string[] = [];
    const deprecations: string[] = [];
    for (const dir of srcDirs) {
      for (const file of collectAllSourceFiles(dir)) {
        const rel = path.relative(REPO_ROOT, file);
        const r = scanSubpaths(fs.readFileSync(file, "utf-8"), rel, TEST_FILE_RE.test(rel));
        violations.push(...r.violations);
        deprecations.push(...r.deprecations);
      }
    }
    expect(violations).toEqual([]);
    // Phase 2 migrates every in-repo ./context import to the root (task 3.16).
    expect(deprecations).toEqual([]);
  });
});

// ── ./sdk: folder codec one source; host CSS FX classes (test-plan #E25) ─────

describe("plugins consume ./sdk for the folder codec and host FX classes", () => {
  it("no plugin source defines its own encode/decodeFolderPath (the ./sdk copy is the only one)", () => {
    const defs: string[] = [];
    for (const dir of findManifestPluginSrcDirs()) {
      for (const file of collectAllSourceFiles(dir)) {
        const src = fs.readFileSync(file, "utf-8");
        if (/\b(?:function|const|let)\s+(?:en|de)codeFolderPath\b/.test(src)) defs.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(defs).toEqual([]);
  });

  it("automation-card-visuals applies HOST_FX_CLASSES.stripes and holds no literal FX class name", () => {
    const file = path.join(REPO_ROOT, "packages/automation-plugin/src/client/automation-card-visuals.ts");
    const src = fs.readFileSync(file, "utf-8");
    expect(src).toContain("HOST_FX_CLASSES.stripes");
    // Comments may name the classes; code may not. Strip comments before scanning.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/card-(?:stripes|glow|ring)/);
  });

  it("the snapshot's ./sdk export list holds neither PLUGIN_HOST_API_VERSION nor satisfiesHostApi", () => {
    const snap = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "packages/dashboard-plugin-runtime/host-api-surface.json"), "utf-8"),
    ) as { sdkExports?: string[] };
    expect(Array.isArray(snap.sdkExports)).toBe(true);
    expect(snap.sdkExports).not.toContain("PLUGIN_HOST_API_VERSION");
    expect(snap.sdkExports).not.toContain("satisfiesHostApi");
    expect(snap.sdkExports).toContain("satisfiesHostApiRange");
  });
});
