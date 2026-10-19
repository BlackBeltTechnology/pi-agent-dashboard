/**
 * Full host chrome for a plugin settings page: health pill words, enable
 * switch, breadcrumb, token hygiene, dev-gated slot claims, load-error
 * exception. Harness modelled on PluginSettingsPageCompact.test.tsx.
 *
 * See change: retro-ux-plugin-settings-wave-2 (test-plan #E27, #E28, #E30).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginToggle } from "../../hooks/usePluginToggle.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import type { SettingsPromotion } from "../../lib/settings-promotions.js";
import { PLUGIN_INTERNALS_KEY } from "../../lib/state/plugin-internals-pref.js";
import { PluginSettingsPage } from "../settings/PluginSettingsPage.js";

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({
    install: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    statusFor: () => "idle",
    messageFor: () => "",
  }),
}));

const promotion: SettingsPromotion = {
  pluginId: "quota",
  group: "models",
  label: "Quota",
  description: "Provider usage limits.",
  order: 1000,
};

function quotaRow(
  status: Partial<NonNullable<PluginRow["status"]>> | null = {},
  extra: Partial<PluginRow> = {},
): PluginRow {
  return {
    id: "quota",
    displayName: "Quota",
    priority: 100,
    firstParty: true,
    hasServer: true,
    hasBridge: false,
    hasClient: true,
    claims: [
      { slot: "settings-section", component: "QuotaSettings" },
      { slot: "composer-context-group", component: "QuotaGroup" },
    ],
    requires: null,
    dependsOn: ["core"],
    dependents: ["flows"],
    status:
      status === null
        ? null
        : { id: "quota", displayName: "Quota", enabled: true, loaded: true, claims: 2, missingRequirements: [], ...status },
    ...extra,
  };
}

function toggle(over: Partial<PluginToggle> = {}): PluginToggle {
  return {
    isToggling: () => false,
    toggleErrorFor: () => undefined,
    handleToggle: vi.fn(async () => {}),
    cascadeDialog: null,
    restartRequired: false,
    restarting: false,
    restartError: null,
    handleRestart: vi.fn(async () => {}),
    ...over,
  };
}

function renderPage(row: PluginRow, promo?: SettingsPromotion, onNavigate: (to: string) => void = () => {}, tg = toggle()) {
  return render(<PluginSettingsPage row={row} toggle={tg} onNavigate={onNavigate} promotion={promo} />);
}

/** In-memory localStorage: Node's experimental global shadows jsdom's under some runners. */
function installLocalStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
}

beforeEach(() => installLocalStorage());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PluginSettingsPage — full chrome health states (#E27)", () => {
  const cases: Array<[string, PluginRow, string | null]> = [
    ["healthy", quotaRow(), null],
    ["disabled", quotaRow({ enabled: false }), "Off"],
    ["not loaded", quotaRow({ loaded: false }), "Not loaded"],
    ["error", quotaRow({ error: "boom" }), "Failed to load"],
    ["missing requirement", quotaRow({ missingRequirements: ["file:/x"] }), "Needs setup"],
    ["no status", quotaRow(null), "Status unknown"],
  ];

  for (const [name, row, word] of cases) {
    it(`${name}: ${word === null ? "no pill" : `pill "${word}"`}`, () => {
      renderPage(row);
      const pill = screen.queryByTestId("plugin-page-pill");
      if (word === null) expect(pill).toBeNull();
      else expect(pill?.textContent).toBe(word);
    });
  }

  it("enable control is a role=switch named Enabled keeping its testid", () => {
    const tg = toggle();
    renderPage(quotaRow(), undefined, () => {}, tg);
    const sw = screen.getByRole("switch", { name: "Enabled" });
    expect(sw.getAttribute("data-testid")).toBe("plugin-page-toggle-quota");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(tg.handleToggle).toHaveBeenCalledTimes(1);
    expect((tg.handleToggle as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(false);
  });

  it("switch reflects the disabled state", () => {
    renderPage(quotaRow({ enabled: false }));
    expect(screen.getByRole("switch", { name: "Enabled" }).getAttribute("aria-checked")).toBe("false");
  });

  it("back link precedes the chrome card in the DOM, a tap-target breadcrumb, none at the bottom", () => {
    const onNavigate = vi.fn();
    renderPage(quotaRow(), undefined, onNavigate);
    const back = screen.getByTestId("plugin-page-back-to-index");
    const chrome = screen.getByTestId("plugin-page-chrome");
    expect(back.compareDocumentPosition(chrome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back.className).toContain("tap-target");
    expect(back.className).toContain("font-semibold");
    expect(back.textContent).toContain("Plugins");
    expect(screen.getAllByTestId("plugin-page-back-to-index")).toHaveLength(1);
    fireEvent.click(back);
    expect(onNavigate).toHaveBeenCalledWith("/settings/plugins");
  });

  it("card is rounded-xl, title text-lg, id shown in a readable colour", () => {
    renderPage(quotaRow());
    expect(screen.getByTestId("plugin-page-chrome").className).toContain("rounded-xl");
    expect(screen.getByTestId("plugin-page-title").className).toContain("text-lg");
    const id = screen.getByTestId("plugin-page-id");
    expect(id.textContent).toBe("quota");
    expect(id.className).toContain("--text-secondary");
  });

  it("body wrapper is a uniform grid", () => {
    renderPage(quotaRow());
    const cls = screen.getByTestId("plugin-page-body-quota").className;
    expect(cls).toContain("grid");
    expect(cls).toContain("gap-3");
  });

  it("paints no accent-blue-500, --text-muted, text-[10px] or --accent-<hue> text (full + compact, every banner)", () => {
    const row = quotaRow(
      {
        loaded: false,
        error: "boom",
        missingRequirements: ["pi-ext", "bin", "svc", "file"],
        requirements: {
          piExtensions: [{ name: "pi-ext", satisfied: false }],
          binaries: [{ name: "bin", satisfied: false }],
          services: [{ name: "svc", satisfied: false }],
          paths: [{ name: "file", satisfied: false }],
        },
      } as Partial<NonNullable<PluginRow["status"]>>,
      {},
    );
    localStorage.setItem(PLUGIN_INTERNALS_KEY, "true");
    for (const promo of [undefined, promotion]) {
      for (const tg of [toggle(), toggle({ restartRequired: true, toggleErrorFor: () => "toggle failed" })]) {
        const { container } = renderPage(row, promo, () => {}, tg);
        const html = container.innerHTML;
        expect(html).not.toContain("accent-blue-500");
        expect(html).not.toContain("--text-muted");
        expect(html).not.toContain("text-[10px]");
        expect(html).not.toMatch(/text-\[var\(--accent-/);
        cleanup();
      }
    }
    const disabled = renderPage(quotaRow({ enabled: false }));
    expect(disabled.container.innerHTML).not.toMatch(/--text-muted|text-\[10px\]|text-\[var\(--accent-/);
  });

  it("banners use severity tokens: disabled notice, restart banner, error", () => {
    const { container } = renderPage(quotaRow({ enabled: false }), undefined, () => {}, toggle({ restartRequired: true }));
    expect(container.querySelector("[data-testid='plugin-page-disabled-notice']")?.className).toContain("--severity-");
    expect(container.querySelector("[data-testid='plugin-page-restart-required']")?.className).toContain("--severity-");
  });
});

describe("PluginSettingsPage — slot claims gated by Show plugin internals (#E28)", () => {
  const SLOT = "composer-context-group";

  it("off + full: no slot id text anywhere; dependencies still shown", () => {
    const { container } = renderPage(quotaRow());
    expect(container.textContent).not.toContain(SLOT);
    expect(container.textContent).not.toContain("settings-section");
    expect(screen.queryByTestId("plugin-page-slots")).toBeNull();
    expect(screen.queryByText("Plugin internals")).toBeNull();
    expect(screen.getByTestId("plugin-page-depends-on").textContent).toContain("core");
    expect(screen.getByTestId("plugin-page-dependents").textContent).toContain("flows");
  });

  it("off + compact: no slot id text anywhere; deps + id stay in Plugin details", () => {
    const { container } = renderPage(quotaRow(), promotion);
    expect(container.textContent).not.toContain(SLOT);
    expect(screen.queryByTestId("plugin-page-slots")).toBeNull();
    const details = screen.getByTestId("plugin-page-details") as HTMLDetailsElement;
    expect(details.contains(screen.getByTestId("plugin-page-depends-on"))).toBe(true);
    expect(details.contains(screen.getByTestId("plugin-page-dependents"))).toBe(true);
    expect(details.contains(screen.getByTestId("plugin-page-id"))).toBe(true);
  });

  it("on + full: collapsed 'Plugin internals' disclosure lists id and slots", () => {
    localStorage.setItem(PLUGIN_INTERNALS_KEY, "true");
    renderPage(quotaRow());
    const disclosure = screen.getByTestId("plugin-page-internals") as HTMLDetailsElement;
    expect(disclosure.tagName).toBe("DETAILS");
    expect(disclosure.open).toBe(false);
    expect(within(disclosure).getByText("Plugin internals")).toBeTruthy();
    const slots = screen.getByTestId("plugin-page-slots");
    expect(disclosure.contains(slots)).toBe(true);
    expect(slots.textContent).toContain("composer-context-group");
    expect(slots.textContent).toContain("settings-section");
    expect(disclosure.textContent).toContain("quota");
    // The chrome card still contains it.
    expect(screen.getByTestId("plugin-page-chrome").contains(disclosure)).toBe(true);
    // Dependencies stay outside the disclosure, always visible.
    expect(disclosure.contains(screen.getByTestId("plugin-page-depends-on"))).toBe(false);
  });

  it("on + compact: slots inside the existing 'Plugin details' disclosure, no second disclosure", () => {
    localStorage.setItem(PLUGIN_INTERNALS_KEY, "true");
    renderPage(quotaRow(), promotion);
    const details = screen.getByTestId("plugin-page-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.contains(screen.getByTestId("plugin-page-slots"))).toBe(true);
    expect(screen.getByTestId("plugin-page-slots").textContent).toContain("settings-section");
    expect(screen.queryByTestId("plugin-page-internals")).toBeNull();
  });

  it("on but the plugin claims nothing: no internals disclosure", () => {
    localStorage.setItem(PLUGIN_INTERNALS_KEY, "true");
    renderPage(quotaRow({}, { claims: [] }));
    expect(screen.queryByTestId("plugin-page-internals")).toBeNull();
  });
});

describe("PluginSettingsPage — load-error exception (#E30)", () => {
  it("shows the one-sentence notice AND the full copyable error text", () => {
    renderPage(quotaRow({ loaded: false, error: "Bridge path conflict: x" }));
    expect(screen.getByText("This plugin failed to load.")).toBeTruthy();
    const block = screen.getByTestId("plugin-status-error-quota");
    expect(block.textContent).toContain("Bridge path conflict: x");
    expect(screen.getByTestId("plugin-status-error-quota-copy")).toBeTruthy();
    expect(screen.getByTestId("plugin-page-pill").textContent).toBe("Failed to load");
  });

  it("no sentence for a healthy plugin", () => {
    renderPage(quotaRow());
    expect(screen.queryByText("This plugin failed to load.")).toBeNull();
    expect(screen.queryByTestId("plugin-status-error-quota")).toBeNull();
  });
});
