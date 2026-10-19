/**
 * The settings navigation rail meets the contrast, target-size and state-marker
 * floors (test-plan #E12). The plugin body is stubbed as in
 * `SettingsPromotedDirty.test.tsx`: a dirty draft source filed under
 * `plugins/roles` drives the dirty dots.
 * See change: align-ui-contract-recipes (design D7).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel.js";
import { makeList, makeService, ok, stubServicesFetch } from "../services/__tests__/services-fixtures.js";

const { fetchAutoInitWorktreePref, setAutoInitWorktreePref } = vi.hoisted(() => ({
  fetchAutoInitWorktreePref: vi.fn(),
  setAutoInitWorktreePref: vi.fn(),
}));
vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return { ...actual, fetchAutoInitWorktreePref, setAutoInitWorktreePref };
});
vi.mock("../../../lib/api/model-proxy-api.js", () => ({
  listApiKeys: vi.fn().mockResolvedValue({ keys: [], revoked: [] }),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn().mockResolvedValue(undefined),
  deleteApiKey: vi.fn().mockResolvedValue(undefined),
  refreshRegistry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({ install: vi.fn(), remove: vi.fn(), update: vi.fn(), statusFor: () => "idle", messageFor: () => "" }),
}));
vi.mock("../PluginSettingsPage.js", async () => {
  const { createElement } = await import("react");
  const { useSettingsDraftSource } = await import("@blackbelt-technology/dashboard-plugin-runtime");
  return {
    PluginNotFoundNotice: () => createElement("div"),
    PluginSettingsPage: () => {
      useSettingsDraftSource({ id: "plugin:roles", page: "plugins/roles", isDirty: true, commit: async () => {}, reset: () => {} });
      return createElement("div", { "data-testid": "roles-body-stub" });
    },
  };
});

const mockConfig = {
  port: 8000,
  piPort: 9999,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "headless",
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 200, maxStringFieldSize: 4000, maxWsBufferBytes: 4194304 },
};

const pluginRow = (id: string, over: Record<string, unknown> = {}, nav?: unknown, status: Record<string, unknown> = {}) => ({
  id,
  displayName: id[0].toUpperCase() + id.slice(1),
  priority: 100,
  firstParty: true,
  hasServer: false,
  hasBridge: false,
  hasClient: true,
  claims: [{ slot: "settings-section", component: `${id}Settings`, ...(nav ? { nav } : {}) }],
  requires: null,
  status: { id, displayName: id, enabled: true, loaded: true, claims: 1, ...status },
  ...over,
});

let plugins: ReturnType<typeof pluginRow>[];

function mount(path: string) {
  window.history.replaceState({}, "", path);
  stubServicesFetch({
    list: () => makeList([makeService({ id: "docling", state: "failed" })]),
    handler: (c) => {
      if (c.url === "/api/config" && c.method === "GET") return ok(mockConfig);
      if (c.url.endsWith("/api/plugins")) return new Response(JSON.stringify({ success: true, plugins }), { headers: { "content-type": "application/json" } });
      return undefined;
    },
  });
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: Parameters<typeof fetch>[1]) => {
    if (url === "/api/config" && !init?.method) return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, data: mockConfig }) });
    if (url.includes("/api/health")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, startedAt: "2025-01-01T00:00:00Z" }) });
    return (original as typeof fetch)(url, init);
  });
  render(<SettingsPanel />);
}

const rail = () => screen.getByTestId("settings-nav-rail");

beforeEach(() => {
  vi.restoreAllMocks();
  fetchAutoInitWorktreePref.mockResolvedValue(false);
  setAutoInitWorktreePref.mockResolvedValue(true);
  plugins = [
    pluginRow("roles", {}, { group: "models", label: "Model roles" }),
    pluginRow("quota"),
    pluginRow("other", {}, undefined, { loaded: false }),
  ];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("settings rail (#E12)", () => {
  it("inactive items are secondary text, with no muted colour and no opacity dimming anywhere in the rail", async () => {
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const html = rail().outerHTML;
    expect(html).not.toContain("--text-muted");
    expect(html).not.toContain("text-muted");
    expect(html).not.toContain("opacity-60");
    const idle = within(rail()).getByRole("button", { name: "General" });
    expect(idle.className).toContain("text-[var(--text-secondary)]");
  });

  it("every rail button is 36 px tall (44 px below sm)", async () => {
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const buttons = Array.from(rail().querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      expect(b.className, b.textContent ?? "").toContain("min-h-[36px]");
      expect(b.className, b.textContent ?? "").toContain("max-sm:min-h-[44px]");
    }
  });

  it("the current item has aria-current, a tertiary fill, semibold text and the accent bar; others have none", async () => {
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const current = rail().querySelectorAll("[aria-current='page']");
    expect(current).toHaveLength(1);
    const cls = (current[0] as HTMLElement).className;
    expect(cls).toContain("bg-[var(--bg-tertiary)]");
    expect(cls).toContain("font-semibold");
    expect(cls).toContain("text-[var(--text-primary)]");
    expect(cls).toContain("before:bg-[var(--accent-primary)]");
    // bottom edge in the strip below md, leading edge from md
    expect(cls).toContain("before:bottom-0");
    expect(cls).toContain("md:before:left-0");
    expect(cls).not.toContain("bg-blue-600");
    const idle = within(rail()).getByRole("button", { name: "General" });
    expect(idle.className).not.toContain("before:bg-[var(--accent-primary)]");
    expect(idle.className).not.toContain("font-semibold");
  });

  it("the Services attention marker is an icon (a shape) with its screen-reader count", async () => {
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const marker = await screen.findByTestId("nav-services-attention");
    const svg = marker.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(marker.querySelector(".sr-only")?.textContent).toBe("1 services need attention");
    expect(marker.innerHTML).not.toContain("rounded-full");
    expect(marker.innerHTML).toContain("--severity-error-fg");
  });

  it("group labels are 11 px semibold in the secondary colour", async () => {
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const labels = Array.from(rail().querySelectorAll("[data-testid^='settings-nav-group-label-']"));
    expect(labels.length).toBeGreaterThan(1);
    for (const l of labels) {
      expect(l.className).toContain("text-[11px]");
      expect(l.className).toContain("font-semibold");
      expect(l.className).toContain("text-[var(--text-secondary)]");
      expect(l.className).not.toContain("text-[var(--text-tertiary)]");
      expect(l.className).not.toContain("font-bold");
    }
  });

  it("a dirty page's indicator is a severity token, not a palette class", async () => {
    mount("/settings/plugins/roles");
    await screen.findByTestId("roles-body-stub");
    const dirty = await within(rail()).findAllByTestId("nav-dirty-plugins/roles");
    expect(dirty.length).toBeGreaterThan(0);
    for (const d of dirty) {
      expect(d.className).toContain("bg-[var(--severity-warning-fg)]");
      expect(d.className).not.toContain("bg-amber-400");
      expect(d.getAttribute("title")).toBe("Unsaved changes on this page");
    }
  });

  it("a promoted plugin row is not dimmed, in secondary text, with its status dot on a severity token", async () => {
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const promoted = await within(rail()).findByTestId("nav-promoted-roles");
    expect(promoted.className).not.toContain("opacity-60");
    expect(promoted.className).toContain("text-[var(--text-secondary)]");
    const dot = within(promoted).getByTestId("nav-plugin-status-roles");
    expect(dot.className).toContain("bg-[var(--severity-success-fg)]");
    expect(dot.getAttribute("aria-label")).toBe("loaded");
    expect(dot.getAttribute("role")).toBe("img");
  });

  it("a disabled promoted plugin stays listed with its off marker, undimmed and at least 12 px", async () => {
    plugins = [pluginRow("roles", {}, { group: "models", label: "Model roles" }, { enabled: false, loaded: false })];
    mount("/settings/services");
    await screen.findByTestId("services-list-page");
    const promoted = await within(rail()).findByTestId("nav-promoted-roles");
    expect(promoted.className).not.toContain("opacity-60");
    const off = within(promoted).getByTestId("nav-promoted-off-roles");
    expect(off.textContent).toBe("off");
    expect(off.className).toContain("text-xs");
    expect(off.className).not.toContain("text-[10px]");
  });

  it("plugin child rows and pointer hints: no muted colour; the hint is at least 12 px", async () => {
    // A plugin route forces the plugins group open, so its children render.
    mount("/settings/plugins/quota");
    const toggle = await screen.findByTestId("nav-plugins-toggle");
    expect(toggle.className).not.toContain("text-muted");
    expect(toggle.className).not.toContain("opacity-60");
    expect(toggle.className).toContain("min-h-[36px]");
    expect(toggle.className).toContain("text-xs");
    // the open child is current: aria-current, tertiary fill, bar
    const current = await within(rail()).findByTestId("nav-plugin-quota");
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("bg-[var(--bg-tertiary)]");
    // an idle child: secondary text, 36 px, its dot on a severity token
    const idle = await within(rail()).findByTestId("nav-plugin-other");
    expect(idle.className).toContain("text-[var(--text-secondary)]");
    expect(idle.className).toContain("min-h-[36px]");
    expect(idle.className).not.toContain("text-muted");
    expect(within(idle).getByTestId("nav-plugin-status-other").className).toContain("bg-[var(--severity-warning-fg)]");
    // the pointer to the promoted plugin: undimmed, secondary, hint at 12 px
    const pointer = await within(rail()).findByTestId("nav-plugin-pointer-roles");
    expect(pointer.className).not.toContain("opacity-60");
    expect(pointer.className).toContain("text-[var(--text-secondary)]");
    expect(pointer.getAttribute("aria-current")).toBeNull();
    const hint = pointer.querySelector("span.ml-auto") as HTMLElement;
    expect(hint.className).toContain("text-xs");
    expect(hint.textContent).toContain("↗");
  });

  it("the rendered rail holds no raw palette class, hex or rgba literal", async () => {
    mount("/settings/plugins/roles");
    await screen.findByTestId("roles-body-stub");
    await within(rail()).findAllByTestId("nav-dirty-plugins/roles");
    const html = rail().outerHTML;
    expect(html).not.toMatch(/\b(?:text|bg|border|ring|outline|divide|shadow|from|via|to)-(?:green|orange|blue|yellow|indigo|red|amber|purple|emerald|sky)-\d/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("rgba(");
  });
});
