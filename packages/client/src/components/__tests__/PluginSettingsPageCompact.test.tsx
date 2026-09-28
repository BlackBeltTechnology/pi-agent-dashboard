/**
 * Compact host chrome for a PROMOTED plugin settings page.
 * Harness modelled on PluginSettingsRoutes.test.tsx, but renders the page
 * directly with a `promotion` so every chrome branch is reachable.
 *
 * See change: promote-model-roles-settings (test-plan #F6–#F9, #X3).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginToggle } from "../../hooks/usePluginToggle.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import type { SettingsPromotion } from "../../lib/settings-promotions.js";
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
  pluginId: "roles",
  group: "models",
  label: "Model roles",
  description: "Pick which model answers each @role.",
  order: 1000,
};

function rolesRow(status: Partial<NonNullable<PluginRow["status"]>> | null = {}, extra: Partial<PluginRow> = {}): PluginRow {
  return {
    id: "roles",
    displayName: "Roles",
    priority: 100,
    firstParty: true,
    hasServer: true,
    hasBridge: false,
    hasClient: true,
    claims: [{ slot: "settings-section", component: "BuiltInRolesSettings" }],
    requires: null,
    dependsOn: ["core"],
    dependents: ["flows"],
    status:
      status === null
        ? null
        : { id: "roles", displayName: "Roles", enabled: true, loaded: true, claims: 1, missingRequirements: [], ...status },
    ...extra,
  };
}

function toggle(): PluginToggle {
  return {
    isToggling: () => false,
    toggleErrorFor: () => undefined,
    handleToggle: vi.fn(async () => {}),
    cascadeDialog: null,
    restartRequired: false,
    restarting: false,
    restartError: null,
    handleRestart: vi.fn(async () => {}),
  };
}

function renderPage(row: PluginRow, promo: SettingsPromotion = promotion) {
  return render(<PluginSettingsPage row={row} toggle={toggle()} onNavigate={() => {}} promotion={promo} />);
}

afterEach(() => cleanup());

describe("PluginSettingsPage — compact chrome", () => {
  it("F6: healthy promoted page shows title, lede, provenance + toggle, no pill; metadata behind the disclosure", () => {
    renderPage(rolesRow());
    expect(screen.getByTestId("plugin-page-title").textContent).toBe("Model roles");
    expect(screen.getByTestId("plugin-page-lede").textContent).toBe(promotion.description);
    const provenance = screen.getByTestId("plugin-page-provenance");
    expect(provenance.textContent).toContain("Provided by the Roles plugin");
    expect(within(provenance).getByTestId("plugin-page-toggle-roles")).toBeTruthy();
    expect(screen.queryByTestId("plugin-page-pill")).toBeNull();

    const details = screen.getByTestId("plugin-page-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    for (const id of ["plugin-page-id", "plugin-page-depends-on", "plugin-page-dependents", "plugin-page-slots"]) {
      expect(details.contains(screen.getByTestId(id))).toBe(true);
    }
    expect(screen.getByTestId("plugin-page-id").textContent).toContain("roles");
    expect(screen.getByTestId("plugin-page-depends-on").textContent).toContain("core");
    expect(screen.getByTestId("plugin-page-dependents").textContent).toContain("flows");
    expect(screen.getByTestId("plugin-page-slots").textContent).toContain("settings-section");
    fireEvent.click(within(details).getByText(/details/i));
    expect(details.open).toBe(true);
  });

  it("F7: header pill only for unhealthy rows, never inside the disclosure", () => {
    const cases: Array<[PluginRow, string | null]> = [
      [rolesRow({ enabled: false }), "disabled"],
      [rolesRow({ error: "boom" }), "error"],
      [rolesRow({ loaded: false }), "not loaded"],
      [rolesRow(null), "unknown"],
      [rolesRow({ missingRequirements: ["pi-roles"] }), "requirements"],
      [rolesRow(), null],
    ];
    for (const [row, label] of cases) {
      renderPage(row);
      const pill = screen.queryByTestId("plugin-page-pill");
      if (label === null) {
        expect(pill).toBeNull();
      } else {
        expect(pill?.textContent).toBe(label);
        expect(screen.getByTestId("plugin-page-compact-header").contains(pill)).toBe(true);
        expect(screen.getByTestId("plugin-page-details").contains(pill)).toBe(false);
      }
      cleanup();
    }
  });

  it("F8: nav label renders as text; provenance strips Cc/Cf from displayName", () => {
    const { container } = renderPage(rolesRow({}, { displayName: "Ro\u202Eles" }), {
      ...promotion,
      label: "<b>x</b>",
    });
    expect(screen.getByTestId("plugin-page-title").textContent).toBe("<b>x</b>");
    expect(container.querySelector("b")).toBeNull();
    const provenance = screen.getByTestId("plugin-page-provenance").textContent ?? "";
    expect(provenance).toContain("Roles");
    expect(provenance).not.toContain("\u202E");
  });

  it("F9: disabling while open swaps the body for the disabled notice, chrome stays", () => {
    const { rerender } = renderPage(rolesRow());
    expect(screen.getByTestId("plugin-page-body-roles")).toBeTruthy();
    rerender(
      <PluginSettingsPage row={rolesRow({ enabled: false })} toggle={toggle()} onNavigate={() => {}} promotion={promotion} />,
    );
    expect(screen.queryByTestId("plugin-page-body-roles")).toBeNull();
    expect(screen.getByTestId("plugin-page-disabled-notice")).toBeTruthy();
    expect(screen.getByTestId("plugin-page-chrome")).toBeTruthy();
    expect(screen.getByTestId("plugin-page-title").textContent).toBe("Model roles");
  });

  it("X3: a load error shows the error pill and the copy-on-click block", () => {
    renderPage(rolesRow({ loaded: false, error: "Bridge path conflict: x" }));
    expect(screen.getByTestId("plugin-page-pill").textContent).toBe("error");
    expect(screen.getByTestId("plugin-status-error-roles").textContent).toContain("Bridge path conflict: x");
    // Nothing of the plugin's own is mounted in the body slot.
    expect(screen.getByTestId("plugin-page-body-roles").children).toHaveLength(0);
  });
});
