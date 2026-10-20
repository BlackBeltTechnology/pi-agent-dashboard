/**
 * Cross-plugin settings consistency (test-plan #E6, #E7, #E8): every plugin
 * settings component adopts the settings kit — no native checkbox, boolean
 * controls are `role="switch"`, every control has an accessible name, every
 * `aria-describedby` id resolves, no identity header repeats the tab title,
 * and the master switches carry short human names.
 *
 * Each case mounts the REAL component inside the real plugin runtime
 * (`PluginContextProvider` + `CurrentPluginLayer` + `SettingsDraftProvider`),
 * with a per-plugin `fetch` stub and a fixture config. The plugin id and
 * display name come from each package manifest (`pi-dashboard-plugin`).
 * i18n catalogs (#E31) are covered by each plugin's own i18n test + the
 * repo i18n scripts.
 * See change: retro-ux-plugin-settings-wave-2.
 */
import fs from "node:fs";
import path from "node:path";
import { applyPluginConfigUpdate, CurrentPluginLayer, createSlotRegistry, PluginContextProvider, type RegisteredSource, SettingsDraftProvider, type SettingsDraftRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppleToolsSettings } from "../../../apple-tools/src/client/AppleToolsSettings.js";
import { AutomationSettings } from "../../../automation-plugin/src/client/AutomationSettings.js";
import { BlackholeSettings } from "../../../blackhole-plugin/src/client/BlackholeSettings.js";
import { DEFAULTS, KNOWN_KEYS } from "../../../blackhole-plugin/src/shared/blackhole-config.js";
import { BrowserSettings } from "../../../browser-plugin/src/client/BrowserSettings.js";
import { ChatGatewaySettings } from "../../../chat-gateway/src/client/ChatGatewaySettings.js";
import { CostSettings } from "../../../cost-estimator/src/client/CostEstimator.js";
import { FlowsAnthropicBridgeSettings } from "../../../flows-anthropic-bridge-plugin/src/FlowsAnthropicBridgeSettings.js";
import { FlowsSettings } from "../../../flows-plugin/src/client/FlowsSettings.js";
import { GoalPluginSettings } from "../../../goal-plugin/src/client/GoalPluginSettings.js";
import { GrammarSettings } from "../../../grammar-plugin/src/GrammarSettings.js";
import { McpSettings } from "../../../mcp-client-plugin/src/client/McpSettings.js";
import { ObsSettingsCard } from "../../../obs-studio-plugin/src/client/ObsSettingsCard.js";
import { QuotaSettings } from "../../../quota-plugin/src/QuotaSettings.js";
import { SubagentsSettings } from "../../../subagents-plugin/src/client/SubagentsSettings.js";
import { SystemOneSettings } from "../../../system-one-plugin/src/client/SystemOneSettings.js";

const PACKAGES_ROOT = path.resolve(__dirname, "../../..");

type FetchRoute = (url: string, init?: RequestInit) => unknown;

interface PluginCase {
  /** Package directory under `packages/`. */
  dir: string;
  Component: () => React.ReactElement;
  /** Fixture `plugin_config_update` payloads, by plugin id (own id first). */
  configs?: Record<string, Record<string, unknown>>;
  /** Per-URL JSON bodies for the plugin's `fetch` stub (first matching substring wins). */
  routes?: Array<[string, unknown]>;
  /** A `data-testid` (or, when starting with `[`, a CSS selector) present once the body has loaded. */
  ready: string;
  /** Minimum number of `role="switch"` controls the fixture must render. */
  minSwitches: number;
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function manifest(dir: string): { id: string; displayName: string } {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGES_ROOT, dir, "package.json"), "utf-8")) as {
    "pi-dashboard-plugin": { id: string; displayName: string };
  };
  return pkg["pi-dashboard-plugin"];
}

// ---------------------------------------------------------------------------
// Accessibility helpers (accname subset: aria-label, aria-labelledby, label[for],
// wrapping label, text content for buttons — no `title`/`placeholder` fallback).
// ---------------------------------------------------------------------------

const CONTROL_SELECTOR =
  "input:not([type=hidden]), select, textarea, [role=switch], [role=combobox], [role=slider], [role=radio]";

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const joined = labelledBy
      .split(/\s+/)
      .map((id) => textOf(el.ownerDocument.getElementById(id)))
      .join(" ")
      .trim();
    if (joined) return joined;
  }
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const id = el.getAttribute("id");
  if (id) {
    const forLabel = [...el.ownerDocument.querySelectorAll("label")].find((l) => l.htmlFor === id);
    if (forLabel && textOf(forLabel)) return textOf(forLabel);
  }
  const wrapping = el.closest("label");
  if (wrapping && textOf(wrapping)) return textOf(wrapping);
  if (el.tagName === "BUTTON" || el.getAttribute("role") === "switch") return textOf(el);
  return "";
}

function describe_(el: Element): string {
  const testid = el.getAttribute("data-testid");
  return `<${el.tagName.toLowerCase()}${el.getAttribute("type") ? ` type=${el.getAttribute("type")}` : ""}${testid ? ` data-testid=${testid}` : ""}>`;
}

function textNodes(root: Element): string[] {
  const out: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-plugin fixtures
// ---------------------------------------------------------------------------

const PROVIDERS_QUOTA = { providers: [] };

/** Blackhole `GET /config` body with every known key at its default. */
const BLACKHOLE_CONFIG = {
  status: "ok",
  filePath: "/tmp/agent/pi-blackhole/pi-blackhole-config.json",
  exists: false,
  unmanagedKeys: [],
  fields: Object.fromEntries(
    KNOWN_KEYS.map((k) => {
      const def = (DEFAULTS as Record<string, unknown>)[k];
      return [k, { value: def, default: def, isDefault: true }];
    }),
  ),
};

/** One Pi-global MCP server row, so the row enable switch renders. */
const MCP_SERVER = {
  name: "demo",
  provenance: "pi-global",
  entry: { command: "demo-mcp" },
  transport: "stdio",
  enabled: true,
  exposure: "codemode",
  active: true,
  ignoredKeys: [],
  adapterLeftovers: [],
};

const SYSTEM_ONE_CONFIG = {
  revision: "r1",
  exists: true,
  path: "~/.pi/agent/system-one.json",
  config: {
    allowOffMachine: false,
    backends: { von: { kind: "managed", engine: "von" } },
    presets: { default: { chain: ["von"] } },
    activePreset: "default",
    calibration: {},
  },
  backends: {
    von: {
      capabilities: { maxContextTokens: 8192, maxOptions: null, languages: null, primitives: null },
      offMachine: false,
      egress: "loopback",
      keyRef: null,
      languageLabel: null,
      priceUsdPerMTok: null,
      managed: { state: "stopped" },
    },
  },
};

const PLUGINS: PluginCase[] = [
  {
    dir: "apple-tools",
    Component: AppleToolsSettings,
    configs: { "apple-tools": {} },
    routes: [
      ["/api/plugins", { success: true, plugins: [{ id: "apple-tools", status: { id: "apple-tools", enabled: true, loaded: true, missingDeps: [] } }] }],
      ["/api/apple-tools/status", { state: "ready", platform: "darwin", appPresent: true }],
    ],
    ready: "apple-tools-settings",
    minSwitches: 0,
  },
  { dir: "automation-plugin", Component: AutomationSettings, configs: { automation: {}, roles: {} }, ready: "automation-plugin-settings", minSwitches: 2 },
  { dir: "blackhole-plugin", Component: BlackholeSettings, routes: [["/api/plugins/blackhole/config", BLACKHOLE_CONFIG], ["/api/plugins/blackhole/status", { installed: true }], ["/api/models", { object: "list", data: [] }]], ready: "blackhole-apply-note", minSwitches: 4 },
  {
    dir: "browser-plugin",
    Component: BrowserSettings,
    routes: [
      ["/status", { enabled: true, canOpenChrome: true }],
      ["/profiles", { profiles: { OSS: { profileDirectory: "OSS", label: "OSS", installed: true, hasToken: false, instances: [] } } }],
      ["/audit", { entries: [] }],
    ], ready: "browser-settings", minSwitches: 3 },
  { dir: "chat-gateway", Component: ChatGatewaySettings as unknown as () => React.ReactElement, configs: { "chat-gateway": {} }, routes: [["/api/chat-gateway/bindings", { bindings: [], status: { running: false, boundChannels: 0, pendingSpawns: 0 } }]], ready: "chat-gateway-settings", minSwitches: 3 },
  { dir: "cost-estimator", Component: CostSettings, configs: { "cost-estimator": { seatPlan: "custom", seatMonthlyUsd: 25, seats: 3, gapCapMinutes: 15 } }, ready: "cost-seats", minSwitches: 0 },
  { dir: "flows-anthropic-bridge-plugin", Component: FlowsAnthropicBridgeSettings, configs: { "flows-anthropic-bridge": {} }, routes: [["/status", { sessions: [] }]], ready: "flows-anthropic-bridge-settings", minSwitches: 0 },
  { dir: "grammar-plugin", Component: GrammarSettings, configs: { grammar: { enabled: true, autoCheck: true } }, ready: "grammar-enabled", minSwitches: 3 },
  { dir: "quota-plugin", Component: QuotaSettings, configs: { quota: { enabled: true } }, routes: [["/api/quota", PROVIDERS_QUOTA]], ready: "quota-settings", minSwitches: 2 },
  { dir: "mcp-client-plugin", Component: McpSettings, routes: [["/effective", { scope: "global", servers: [MCP_SERVER], layers: [] }], ["/live", { ok: true, servers: {}, errors: [] }], ["/schema", {}]], ready: "mcp-settings", minSwitches: 1 },
  { dir: "system-one-plugin", Component: SystemOneSettings, routes: [["/keys", { keys: {} }], ["/consumers", { consumers: [] }], ["/config", SYSTEM_ONE_CONFIG]], ready: "system-one-settings", minSwitches: 1 },
  { dir: "obs-studio-plugin", Component: ObsSettingsCard, routes: [["/instances", { instances: [] }]], ready: "obs-settings-none", minSwitches: 0 },
  { dir: "goal-plugin", Component: GoalPluginSettings, ready: "goal-settings-auto-respawn-default", minSwitches: 1 },
  { dir: "flows-plugin", Component: FlowsSettings, configs: { flows: {} }, ready: "flows-edit-mode-toggle", minSwitches: 1 },
  { dir: "subagents-plugin", Component: SubagentsSettings, configs: { subagents: { inheritContext: true } }, ready: "[role=switch]", minSwitches: 1 },
];

function installFetch(routes: Array<[string, unknown]> = []) {
  const route: FetchRoute = (url) => {
    for (const [needle, body] of routes) if (url.includes(needle)) return body;
    return {};
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => route(String(url), init),
    })),
  );
}

const Stub = () => null;

async function mountPlugin(c: PluginCase): Promise<HTMLElement> {
  const { id } = manifest(c.dir);
  const sources = new Map<string, RegisteredSource>();
  const registry: SettingsDraftRegistry = {
    upsert: (sid, s) => sources.set(sid, s),
    remove: (sid) => {
      sources.delete(sid);
    },
  };
  act(() => {
    for (const [cid, config] of Object.entries(c.configs ?? {})) {
      applyPluginConfigUpdate({ type: "plugin_config_update", id: cid, config });
    }
  });
  const location = memoryLocation({ path: `/settings/plugins/${id}` });
  const { Component } = c;
  const view = render(
    withUiPrimitiveProvider(
      {
        [UI_PRIMITIVE_KEYS.modelSelector]: Stub,
        [UI_PRIMITIVE_KEYS.thinkingLevelSelector]: Stub,
        [UI_PRIMITIVE_KEYS.confirmDialog]: Stub,
      },
      <Router hook={location.hook}>
        <SettingsDraftProvider registry={registry}>
          <PluginContextProvider registry={createSlotRegistry()} sessions={[]} send={vi.fn()}>
            <CurrentPluginLayer pluginId={id}>
              <Component />
            </CurrentPluginLayer>
          </PluginContextProvider>
        </SettingsDraftProvider>
      </Router>,
    ),
  );
  await waitFor(() =>
    expect(c.ready.startsWith("[") ? view.container.querySelector(c.ready) : view.queryByTestId(c.ready)).not.toBeNull(),
  );
  return view.container;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("plugin settings consistency — kit adoption (#E6)", () => {
  it.each(PLUGINS.map((c) => [c.dir, c] as const))("%s: no native checkbox, named controls, switches, hint ids resolve", async (_dir, c) => {
    installFetch(c.routes);
    const body = await mountPlugin(c);

    // 0 native checkboxes (mcp-client: ServerEditor is a dialog opened on demand, exempt).
    const checkboxes = [...body.querySelectorAll("input[type=checkbox]")].filter(
      (el) => !el.closest("[data-testid^='mcp-editor'], [data-testid='mcp-folder-editor']"),
    );
    expect(checkboxes.map(describe_)).toEqual([]);

    // Every boolean control is a role="switch" (aria-checked on anything else is a regression;
    // radios in a radiogroup are the only other legitimate aria-checked carrier).
    const wrongRole = [...body.querySelectorAll("[aria-checked]")].filter(
      (el) => !["switch", "radio"].includes(el.getAttribute("role") ?? ""),
    );
    expect(wrongRole.map(describe_)).toEqual([]);
    expect(body.querySelectorAll("[role=switch]").length).toBeGreaterThanOrEqual(c.minSwitches);

    // Every control has an accessible name.
    const unnamed = [...body.querySelectorAll(CONTROL_SELECTOR)].filter((el) => accessibleName(el) === "");
    expect(unnamed.map(describe_)).toEqual([]);

    // Every aria-describedby id resolves to an element in the document.
    const dangling: string[] = [];
    for (const el of body.querySelectorAll("[aria-describedby]")) {
      for (const ref of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
        if (!el.ownerDocument.getElementById(ref)) dangling.push(`${describe_(el)} → #${ref}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});

describe("plugin settings consistency — no identity header (#E7)", () => {
  const E7 = ["apple-tools", "flows-anthropic-bridge-plugin", "grammar-plugin", "quota-plugin", "system-one-plugin", "mcp-client-plugin"];
  it.each(PLUGINS.filter((c) => E7.includes(c.dir)).map((c) => [c.dir, c] as const))(
    "%s: no text node equals the plugin displayName or id",
    async (_dir, c) => {
      installFetch(c.routes);
      const body = await mountPlugin(c);
      const { id, displayName } = manifest(c.dir);
      const banned = new Set([displayName.toLowerCase(), id.toLowerCase()]);
      const repeats = textNodes(body).filter((t) => banned.has(t.toLowerCase()));
      expect(repeats).toEqual([]);
    },
  );
});

describe("plugin settings consistency — master switch naming (#E8)", () => {
  const E8: Array<{ dir: string; testid: string; name: string }> = [
    { dir: "browser-plugin", testid: "browser-enabled-toggle", name: "Relay connections" },
    { dir: "chat-gateway", testid: "chat-gateway-enabled", name: "Answer Discord messages" },
    { dir: "grammar-plugin", testid: "grammar-enabled", name: "Check grammar in the composer" },
    { dir: "quota-plugin", testid: "quota-enable", name: "Check quotas" },
  ];
  it.each(E8.map((e) => [e.dir, e] as const))("%s: master switch is named by what it does", async (_dir, e) => {
    const c = PLUGINS.find((p) => p.dir === e.dir) as PluginCase;
    installFetch(c.routes);
    const body = await mountPlugin(c);

    const named = [...body.querySelectorAll("[role=switch]")].find((el) => accessibleName(el) === e.name);
    expect(named, `switch named "${e.name}"`).toBeTruthy();
    expect(body.querySelector(`[data-testid='${e.testid}']`)).toBe(named);

    const generic = [...body.querySelectorAll("[role=switch]")].filter((el) =>
      ["enabled", "enable", "on"].includes(accessibleName(el).toLowerCase()),
    );
    expect(generic.map(describe_)).toEqual([]);
  });
});
