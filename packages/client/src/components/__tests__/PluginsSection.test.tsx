/**
 * Tests for the Plugins activation tab.
 * See change: add-plugin-activation-ui.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePluginList, usePluginToggle } from "../../hooks/usePluginToggle.js";
import { PluginsSection } from "../packages/PluginsSection.js";
import type { SettingsPromotion } from "../../lib/settings-promotions.js";

// PluginsSection takes its list/toggle from SettingsPanel so the index and the
// nav rail share one fetch and one desired-state overlay. This harness mounts
// the real hooks so the tests still exercise the true fetch/toggle path.
// See change: plugin-settings-pages.
function MountedPluginsSection({ promotions }: { promotions?: ReadonlyMap<string, SettingsPromotion> } = {}) {
  const list = usePluginList();
  const toggle = usePluginToggle(list);
  // Same predicate SettingsPanel supplies (claims OR intent).
  const contributesSettings = (row: { claims: { slot: string }[] }) =>
    row.claims.some((c) => c.slot === "settings-section");
  return (
    <PluginsSection
      list={list}
      toggle={toggle}
      contributesSettings={contributesSettings as never}
      promotions={promotions}
    />
  );
}

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({
    install: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    statusFor: () => "idle",
    messageFor: () => "",
  }),
}));

const apiBaseMock = vi.hoisted(() => ({ value: "" }));
vi.mock("../../lib/api/api-context.js", () => ({
  getApiBase: () => apiBaseMock.value,
}));

// The cog navigates instead of expanding inline, so capture wouter's navigate.
const navigateSpy = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/settings/plugins", navigateSpy],
}));

function makeFetchSequence(responses: Array<{ url: RegExp; body: any; status?: number }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const match = responses.find((r) => r.url.test(url));
    if (!match) {
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    }
    return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
  });
  return { fetchImpl, calls };
}

function pluginRow(over: any = {}) {
  return {
    id: "demo",
    displayName: "Demo Plugin",
    priority: 100,
    hasServer: false,
    hasBridge: false,
    hasClient: true,
    claims: [{ slot: "settings-section", component: "DemoSettings" }],
    requires: null,
    status: {
      id: "demo",
      displayName: "Demo Plugin",
      enabled: true,
      loaded: true,
      claims: 1,
      missingRequirements: [],
    },
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  apiBaseMock.value = "";
  document.head.querySelectorAll('script[type="importmap"]').forEach((n) => n.remove());
});

describe("PluginsSection", () => {
  it("renders one row per discovered plugin", async () => {
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [pluginRow()] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    expect(await screen.findByTestId("plugin-row-demo")).toBeTruthy();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
  });

  it("align #E8: a failed plugin row shows a word pill and one sentence; the stack is not visible text", async () => {
    const stack = "Error: Cannot find module 'x'\n    at load (a.js:1:1)";
    const { fetchImpl } = makeFetchSequence([
      {
        url: /\/api\/plugins$/,
        body: { success: true, plugins: [pluginRow({ status: { id: "demo", displayName: "Demo Plugin", enabled: true, loaded: false, error: stack, claims: 1, missingRequirements: [] } })] },
      },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);
    render(<MountedPluginsSection />);
    const row = await screen.findByTestId("plugin-row-demo");
    expect(row.textContent).toContain("Failed to load");
    const pill = row.querySelector('[data-status="error"]') as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.className).not.toContain("text-[10px]");
    const notice = screen.getByTestId("plugin-status-error-demo");
    expect(notice.textContent).toContain("This plugin failed to load.");
    expect(row.textContent).not.toContain("Cannot find module");
    expect(screen.getByTestId("plugin-status-error-demo-copy-details")).toBeTruthy();
  });

  it("toggle posts to /api/plugins/:id/toggle and shows the restart banner", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (/\/api\/plugins$/.test(url)) {
        return new Response(
          JSON.stringify({ success: true, plugins: [pluginRow()] }),
          { status: 200 },
        );
      }
      if (/\/api\/health/.test(url)) {
        return new Response(
          JSON.stringify({ ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] }),
          { status: 200 },
        );
      }
      if (/\/api\/plugins\/demo\/toggle/.test(url)) {
        return new Response(JSON.stringify({ success: true, restartRequired: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    const toggle = await screen.findByTestId("plugin-toggle-demo");
    fireEvent.click(toggle);

    // Should have POSTed to the toggle endpoint.
    const togglePost = fetchCalls.find((c) => /\/api\/plugins\/demo\/toggle/.test(c.url));
    expect(togglePost).toBeTruthy();
    expect(togglePost?.init?.method).toBe("POST");

    // Banner appears.
    await waitFor(() => {
      expect(screen.queryByTestId("plugins-restart-required-banner")).toBeTruthy();
    });
  });

  it("the settings cog navigates to the plugin page instead of expanding inline", async () => {
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [pluginRow()] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    const cog = await screen.findByTestId("plugin-expand-demo");
    fireEvent.click(cog);
    expect(navigateSpy).toHaveBeenCalledWith("/settings/plugins/demo");
    // No inline settings body is mounted on the activation index.
    expect(screen.queryByTestId("plugin-settings-demo")).toBeNull();
  });

  it("missing piExtensions render warning with inline Install button when recommended", async () => {
    const row = pluginRow({
      status: {
        id: "demo",
        displayName: "Demo Plugin",
        enabled: true,
        loaded: true,
        claims: 1,
        requirements: {
          piExtensions: [{ name: "pi-web-access", satisfied: false }],
          binaries: [],
          services: [],
        },
        missingRequirements: ["pi-web-access"],
      },
    });
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [row] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    expect(await screen.findByTestId("missing-piExtension-pi-web-access")).toBeTruthy();
    // pi-web-access is in RECOMMENDED_EXTENSIONS so the inline Install button appears.
    expect(screen.getByTestId("install-piExtension-pi-web-access")).toBeTruthy();
  });

  it("missing piExtensions without a recommended match render the fallback link", async () => {
    const row = pluginRow({
      status: {
        id: "demo",
        displayName: "Demo Plugin",
        enabled: true,
        loaded: true,
        claims: 1,
        requirements: {
          piExtensions: [{ name: "some-unknown-extension", satisfied: false }],
          binaries: [],
          services: [],
        },
        missingRequirements: ["some-unknown-extension"],
      },
    });
    const { fetchImpl } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins: [row] } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    render(<MountedPluginsSection />);

    expect(await screen.findByTestId("install-piExtension-link-some-unknown-extension")).toBeTruthy();
    expect(screen.queryByTestId("install-piExtension-some-unknown-extension")).toBeNull();
  });
});

// See change: promote-model-roles-settings (test-plan #F10).
describe("PluginsSection — promoted rows", () => {
  it("F10: a disabled promoted row says it is shown in Models; others keep 'not in Settings nav'", async () => {
    const disabled = (id: string, displayName: string) =>
      pluginRow({
        id,
        displayName,
        status: { id, displayName, enabled: false, loaded: false, claims: 1, missingRequirements: [] },
      });
    const { fetchImpl } = makeFetchSequence([
      {
        url: /\/api\/plugins$/,
        body: { success: true, plugins: [disabled("roles", "Roles"), disabled("subagents", "Subagents")] },
      },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);
    const promotions = new Map<string, SettingsPromotion>([
      ["roles", { pluginId: "roles", group: "models", label: "Model roles", order: 1000 }],
    ]);
    render(<MountedPluginsSection promotions={promotions} />);

    const roles = await screen.findByTestId("plugin-disabled-note-roles");
    expect(roles.textContent).toContain("Models");
    expect(roles.textContent).not.toContain("not in Settings nav");
    expect(screen.getByTestId("plugin-disabled-note-subagents").textContent).toContain("not in Settings nav");
  });
});

// decouple-plugins-from-core test-plan #E65 (task 8.83) + live `plugins_changed` (#F6 mechanism).
describe("PluginsSection — discovery fields and live updates", () => {
  const status = (id: string, over: any = {}) => ({ id, displayName: id, enabled: true, loaded: true, claims: 0, ...over });
  const mount = (plugins: any[]) => {
    const { fetchImpl, calls } = makeFetchSequence([
      { url: /\/api\/plugins$/, body: { success: true, plugins } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);
    render(<MountedPluginsSection />);
    return calls;
  };

  it("E65: renders source, the restart hint, a refusal + reason, and one row per id with the shadowed copy as a sub-line", async () => {
    mount([
      pluginRow({
        id: "quota",
        displayName: "Quota",
        status: status("quota", {
          source: "workspace",
          restartRequired: true,
          shadowed: [{ source: "pi-package", packageDir: "/home/u/.pi/agent/npm/node_modules/quota" }],
        }),
      }),
      pluginRow({
        id: "quota-ui",
        displayName: "Quota UI",
        status: status("quota-ui", { source: "installed", client: { delivery: "refused", refusedReason: "missing-dep" } }),
      }),
    ]);
    expect(await screen.findByTestId("plugin-row-quota")).toBeTruthy();
    expect(screen.getAllByTestId("plugin-row-quota")).toHaveLength(1);
    expect(screen.getByTestId("plugin-source-quota").textContent).toContain("workspace");
    expect(screen.getByTestId("plugin-restart-hint-quota")).toBeTruthy();
    const sub = screen.getByTestId("plugin-shadowed-quota");
    expect(sub.textContent).toContain("pi-package");
    expect(sub.textContent).toContain("/home/u/.pi/agent/npm/node_modules/quota");
    expect(screen.queryByTestId("plugin-shadowed-quota-ui")).toBeNull();
    expect(screen.getByTestId("plugin-source-quota-ui").textContent).toContain("installed");
    const refused = screen.getByTestId("plugin-client-refused-quota-ui");
    expect(refused.textContent).toContain("missing-dep");
    expect(screen.queryByTestId("plugin-restart-hint-quota-ui")).toBeNull();
  });

  it("a local-detected row shows the amber badge + install-globally copy, no failed-to-load notice, toggle disabled", async () => {
    mount([
      pluginRow({
        id: "loc",
        displayName: "Loc",
        status: status("loc", {
          source: "local-detected",
          enabled: false,
          loaded: false,
          error: "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable.",
        }),
      }),
    ]);
    expect(await screen.findByTestId("plugin-local-detected-loc")).toBeTruthy();
    expect(screen.getByTestId("plugin-local-detected-note-loc").textContent).toContain("--scope global");
    expect(screen.queryByTestId("plugin-status-error-loc")).toBeNull();
    expect((screen.getByTestId("plugin-toggle-loc") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("plugin-row-loc").textContent).not.toContain("Failed to load");
  });

  it("F6: a plugins-changed event adds a new row, updates a changed one and drops a vanished one, with NO refetch", async () => {
    const calls = mount([pluginRow({ id: "a", displayName: "A", status: status("a") }), pluginRow({ id: "gone", displayName: "Gone", status: status("gone", { enabled: false, loaded: false }) })]);
    await screen.findByTestId("plugin-row-a");
    const listCalls = () => calls.filter((c) => /\/api\/plugins$/.test(c.url)).length;
    expect(listCalls()).toBe(1);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("plugins-changed", {
          detail: {
            type: "plugins_changed",
            plugins: [status("a", { restartRequired: true, source: "workspace" }), status("fresh", { displayName: "Fresh", source: "pi-package" })],
          },
        }),
      );
    });
    expect(await screen.findByTestId("plugin-row-fresh")).toBeTruthy();
    expect(screen.getByTestId("plugin-source-fresh").textContent).toContain("pi-package");
    expect(screen.getByTestId("plugin-restart-hint-a")).toBeTruthy();
    expect(screen.queryByTestId("plugin-row-gone")).toBeNull();
    expect(listCalls()).toBe(1);
  });
});

// decouple-plugins-from-core test-plan #E104 (8.98) + #E75 notices (8.95) — task 6.13.
describe("PluginsSection — runtime trust actions and notices", () => {
  const HASH = "0123456789abcdef".repeat(4);
  const status = (id: string, over: any = {}) => ({ id, displayName: id, enabled: true, loaded: true, claims: 0, ...over });
  const row = (id: string, over: any = {}, st: any = {}) => pluginRow({ id, displayName: id, packageDir: `/pkgs/${id}`, status: status(id, st), ...over });
  function mount(plugins: any[], extra: Array<{ url: RegExp; body: any; status?: number }> = []) {
    const { fetchImpl, calls } = makeFetchSequence([
      ...extra,
      { url: /\/api\/plugins$/, body: { success: true, plugins } },
      { url: /\/api\/health/, body: { ok: true, startedAt: "2025-01-01T00:00:00Z", plugins: [] } },
    ]);
    vi.stubGlobal("fetch", fetchImpl);
    render(<MountedPluginsSection />);
    return calls;
  }

  it("E104: a structural reason shows its reason and no Trust button; untrusted → Trust; pin-mismatch → Trust this version", async () => {
    mount([
      row("dis", {}, { client: { delivery: "refused", refusedReason: "disabled", sha256: HASH } }),
      row("unt", {}, { client: { delivery: "refused", refusedReason: "untrusted", sha256: HASH } }),
      row("pin", {}, { client: { delivery: "refused", refusedReason: "pin-mismatch", sha256: HASH } }),
    ]);
    await screen.findByTestId("plugin-row-dis");
    expect(screen.getByTestId("plugin-client-refused-dis").textContent).toContain("disabled");
    expect(screen.queryByTestId("plugin-trust-dis")).toBeNull();
    expect(screen.queryByTestId("plugin-trust-panel-dis")).toBeNull();
    expect(screen.getByTestId("plugin-trust-unt").textContent).toBe("Trust");
    expect(screen.getByTestId("plugin-trust-pin").textContent).toBe("Trust this version");
    // shows the package path and the FULL 64-hex hash
    expect(screen.getByTestId("plugin-trust-path-unt").textContent).toContain("/pkgs/unt");
    expect(screen.getByTestId("plugin-trust-hash-unt").textContent).toContain(HASH);
  });

  it("Trust posts the displayed hash; Revoke deletes; local_only is explained", async () => {
    const calls = mount(
      [row("unt", {}, { client: { delivery: "refused", refusedReason: "untrusted", sha256: HASH } }), row("ok", {}, { client: { delivery: "runtime", sha256: HASH } })],
      [{ url: /\/api\/plugins\/unt\/trust$/, body: { success: false, error: "local_only", message: "local only" }, status: 403 }, { url: /\/api\/plugins\/ok\/trust$/, body: { success: true } }],
    );
    fireEvent.click(await screen.findByTestId("plugin-trust-unt"));
    await screen.findByTestId("plugin-trust-error-unt");
    const post = calls.find((c) => /unt\/trust$/.test(c.url))!;
    expect(post.init?.method).toBe("POST");
    expect(JSON.parse(String(post.init?.body))).toEqual({ sha256: HASH });
    expect(screen.getByTestId("plugin-trust-error-unt").textContent).toContain("machine running the dashboard");

    fireEvent.click(screen.getByTestId("plugin-revoke-ok"));
    await waitFor(() => expect(calls.some((c) => /ok\/trust$/.test(c.url) && c.init?.method === "DELETE")).toBe(true));
  });

  it("a server-untrusted pi-package row offers Trust server code → {server:true}", async () => {
    const calls = mount(
      [row("pkg", {}, { source: "pi-package", loaded: false, error: "server-untrusted" })],
      [{ url: /\/api\/plugins\/pkg\/trust$/, body: { success: true } }],
    );
    fireEvent.click(await screen.findByTestId("plugin-trust-server-pkg"));
    await waitFor(() => expect(calls.some((c) => /pkg\/trust$/.test(c.url))).toBe(true));
    expect(JSON.parse(String(calls.find((c) => /pkg\/trust$/.test(c.url))!.init?.body))).toEqual({ server: true });
  });

  it("E75: notices — no import map → production-page notice; remote server → unavailable notice; neither → none", async () => {
    mount([row("a")]);
    expect((await screen.findByTestId("plugins-runtime-notice-no-import-map")).textContent).toContain("Runtime plugins need the production page");
    cleanup();

    apiBaseMock.value = "https://remote:8000";
    mount([row("a")]);
    expect((await screen.findByTestId("plugins-runtime-notice-remote-server")).textContent).toContain("Runtime plugins are unavailable while connected to a remote server");
    cleanup();

    apiBaseMock.value = "";
    const map = document.createElement("script");
    map.type = "importmap";
    map.textContent = "{}";
    document.head.appendChild(map);
    mount([row("a")]);
    await screen.findByTestId("plugin-row-a");
    expect(screen.queryByTestId("plugins-runtime-notice-no-import-map")).toBeNull();
    expect(screen.queryByTestId("plugins-runtime-notice-remote-server")).toBeNull();
  });
});
