/**
 * Inventory + enforcement guard for manifest `emits` (D16): every in-tree plugin
 * that calls `ctx.emitEventToSession` declares `emits` in its manifest, and the
 * real flows + automation manifests, wired through the real seam + registries,
 * emit `flow:run` (via the automation `flows.run` action) and
 * `dashboard-flows:report-files` (flows ctx) with no refusal warning.
 * The worktree boot would discover the MAIN checkout's plugin manifests, so this
 * reads this checkout's manifests directly instead of booting `createServer`.
 * See change: harden-git-terminal-plugin-boundaries (test-plan #SE26; task 6.22).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";
import { createPluginServiceRegistry } from "../../../dashboard-plugin-runtime/src/server/plugin-service-registry.js";
import { computeEmitAllowlist, emitEventToSession, resetEmitWarnings } from "../plugin-event-seam.js";

const PACKAGES = path.resolve(__dirname, "../../..");

/** id → validated manifest for every in-tree plugin package. */
function loadManifests() {
  const out = new Map<string, { dir: string; manifest: ReturnType<typeof validateManifest> }>();
  for (const name of fs.readdirSync(PACKAGES)) {
    const pkgPath = path.join(PACKAGES, name, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"))["pi-dashboard-plugin"];
    if (!raw) continue;
    const manifest = validateManifest(raw);
    out.set(manifest.id, { dir: path.join(PACKAGES, name), manifest });
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

beforeEach(() => resetEmitWarnings());
afterEach(() => vi.restoreAllMocks());

describe("emitEventToSession caller inventory (task 6.22)", () => {
  it("every in-tree plugin that calls emitEventToSession declares manifest `emits`", () => {
    // `"emitEventToSession"` in a denylist string is not a call (mcp-server-plugin).
    const callSite = /(?<!["'\w])emitEventToSession\b(?!["'])/;
    const emitters: string[] = [];
    for (const [id, { dir, manifest }] of loadManifests()) {
      const hasCall = sourceFiles(path.join(dir, "src")).some((f) => callSite.test(fs.readFileSync(f, "utf8")));
      if (hasCall) {
        emitters.push(id);
        expect(Array.isArray(manifest.emits), `plugin "${id}" calls emitEventToSession without manifest emits`).toBe(true);
      }
    }
    // Recorded inventory (design.md D16): automation (dynamic, via accepted actions) + flows.
    expect(emitters.sort()).toEqual(["automation", "flows"]);
  });

  it("flows declares exactly the event types it emits; automation declares none of its own", () => {
    const m = loadManifests();
    // flow:set-edit-mode: the explicit per-project edit-mode action.
    // See change: stop-flows-edit-mode-project-writes (D5).
    expect([...(m.get("flows")!.manifest.emits ?? [])].sort()).toEqual(["dashboard-flows:report-files", "flow:run", "flow:set-edit-mode"]);
    expect(m.get("automation")!.manifest.emits).toEqual([]);
  });
});

describe("real flows + automation manifests under enforcement (SE26)", () => {
  // Plugin code is deliberately not imported (core/plugin boundary ratchet): the flows contribution is
  // restated structurally. The collector itself is covered in automation-plugin's own tests.
  const FLOW_FILES_REQUEST_EVENT = "dashboard-flows:report-files";

  it("flow:run via the automation flows.run action and report-files via flows ctx are dispatched, no refusal warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manifests = loadManifests();
    const live = new Set(["flows", "automation"]);
    const manifestEmits = (id: string) => (live.has(id) ? manifests.get(id)?.manifest.emits ?? [] : undefined);

    const registry = createPluginServiceRegistry();
    registry.provide("flows", "automation.action.flows", [
      { id: "flows.run", source: "flows", emits: ["flow:run"], buildEvent: () => ({ eventType: "flow:run" }) },
    ]);

    const send = vi.fn(() => true);
    const deps = { manifestEmits, actionEntries: () => registry.entries("automation.action.") };
    const emitAs = (pluginId: string, eventType: string) =>
      emitEventToSession(true, send, "s1", eventType, {}, { pluginId, allowed: () => computeEmitAllowlist(pluginId, deps) });

    expect(emitAs("automation", "flow:run")).toBe(true);
    expect(emitAs("flows", FLOW_FILES_REQUEST_EVENT)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
