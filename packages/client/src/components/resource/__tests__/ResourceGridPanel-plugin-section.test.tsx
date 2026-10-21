/**
 * ResourceGridPanel hosts `resource-page-section` claims above the grid
 * (test-plan #E24 client half; pi-resources-view delta).
 * See change: add-skill-atlas-screen.
 */
import {
  PluginContextProvider,
  createSlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceActivationController } from "../../../hooks/useResourceActivation.js";
import { ResourceGridPanel } from "../ResourceGridPanel.js";

afterEach(cleanup);

const activation = {
  isEnabled: () => true, toggle: () => {}, isFolderControlled: () => false, pending: null, reload: () => {},
  clearPending: () => {}, error: null, clearError: () => {}, trustPrompt: null, resolveTrust: () => {}, dismissTrust: () => {},
} as unknown as ResourceActivationController;

const empty = { extensions: [], skills: [], prompts: [], agents: [], themes: [] };
const data: PiResourcesResult = {
  local: { ...empty, skills: [{ name: "local-skill", description: "d", filePath: "/repo/.pi/skills/local-skill/SKILL.md", type: "skill", enabled: true }] },
  global: empty,
  packages: [],
};

function registry() {
  const r = createSlotRegistry();
  r.addClaim({
    pluginId: "skill-atlas",
    priority: 100,
    slot: "resource-page-section",
    resourceType: "skill",
    Component: (p: { scope: string; cwd?: string }) => <div data-testid="atlas-section">{`${p.scope}|${p.cwd ?? "-"}`}</div>,
  });
  return r;
}

function renderPanel(scopes: ("local" | "global")[], cwd?: string, type: "skill" | "agent" = "skill") {
  return render(
    <PluginContextProvider registry={registry()}>
      <ResourceGridPanel
        data={data} isLoading={false} error={null} refresh={() => {}} activation={activation}
        type={type} scopes={scopes} showScopeFilter={scopes.length > 1} onViewFile={() => {}} cwd={cwd}
      />
    </PluginContextProvider>,
  );
}

describe("ResourceGridPanel + resource-page-section", () => {
  it("folder surface passes folder + cwd, section precedes the grid, cards still render", () => {
    const { container } = renderPanel(["local", "global"], "/repo");
    const section = screen.getByTestId("atlas-section");
    expect(section.textContent).toBe("folder|/repo");
    const card = screen.getByText("local-skill");
    expect(section.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container).toBeDefined();
  });

  it("global surface passes no cwd", () => {
    renderPanel(["global"], "/should-not-leak");
    expect(screen.getByTestId("atlas-section").textContent).toBe("global|-");
  });

  it("skill-typed section is absent on the Agents page", () => {
    renderPanel(["local", "global"], "/repo", "agent");
    expect(screen.queryByTestId("atlas-section")).toBeNull();
  });
});
