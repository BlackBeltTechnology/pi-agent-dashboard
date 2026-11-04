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
    // Recorded inventory (design.md D16): automation (dynamic, via accepted actions) + flows,
    // + subagents (`subagents:stop`, change: subagent-queue-visibility D3).
    expect(emitters.sort()).toEqual(["automation", "flows", "subagents"]);
  });

  it("flows declares exactly the event types it emits; automation declares none of its own", () => {
    const m = loadManifests();
    // flow:set-edit-mode: the explicit per-project edit-mode action.
    // See change: stop-flows-edit-mode-project-writes (D5).
    // update-flows-plugin (D2): the flow-control relays are plugin-owned now.
    expect([...(m.get("flows")!.manifest.emits ?? [])].sort()).toEqual([
      "dashboard-flows:report-files",
      "flow:abort",
      "flow:architect-abort",
      "flow:delete-request",
      "flow:notify",
      "flow:run",
      "flow:set-edit-mode",
      "flow:summary-dismissed",
      "flow:toggle-autonomous",
    ]);
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

/** E38: every relayed flow event passes the emits gate; manifest replay types; no /flows command route. See change: update-flows-plugin. */
describe("flows manifest emits + claims (E38)", () => {
  const RELAYED = [
    "flow:run",
    "flow:set-edit-mode",
    "flow:abort",
    "flow:architect-abort",
    "flow:toggle-autonomous",
    "flow:summary-dismissed",
    "flow:delete-request",
    "flow:notify",
  ];
  it("each relayed event passes the real seam with no refusal; replayEntryTypes; no /flows command-route", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manifests = loadManifests();
    const flows = manifests.get("flows")!.manifest;
    expect(flows.emits).toEqual(expect.arrayContaining(RELAYED));
    expect(flows.replayEntryTypes).toEqual(["flow-event"]);
    const registry = createPluginServiceRegistry();
    const deps = {
      manifestEmits: (id: string) => (id === "flows" ? flows.emits ?? [] : undefined),
      actionEntries: () => registry.entries("automation.action."),
    };
    const send = vi.fn(() => true);
    for (const ev of RELAYED) {
      expect(
        emitEventToSession(true, send, "s1", ev, {}, { pluginId: "flows", allowed: () => computeEmitAllowlist("flows", deps) }),
        ev,
      ).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(RELAYED.length);
    expect(warn).not.toHaveBeenCalled();
    const routeClaims = (flows.claims as Array<{ slot?: string; command?: string }>).filter(
      (c) => c.slot === "command-route" && typeof c.command === "string" && c.command.startsWith("/flows"),
    );
    expect(routeClaims).toEqual([]);
  });
});
