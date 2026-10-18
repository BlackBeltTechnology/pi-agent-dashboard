/**
 * OpenSpecWorkflowSchemaSection — change: add-pi-spec-driven-schema.
 * test-plan #F6 (enable confirm), #F7 (state-gated buttons + selector), #F5
 * section half (default switch is a prop-driven draft control).
 */

import type { OpenSpecData, OpenSpecWorkflowSchemaStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSpecMapContext } from "../../lib/openspec/OpenSpecMapContext.js";
import { OpenSpecWorkflowSchemaSection } from "../openspec/OpenSpecWorkflowSchemaSection.js";

const CWD = "/repo/a";

function status(over: Partial<OpenSpecWorkflowSchemaStatus> = {}): OpenSpecWorkflowSchemaStatus {
  return { configured: null, generated: "none", missing: false, unpinnedChanges: [], affectedChanges: [], ...over };
}

function renderSection(
  statuses: Record<string, OpenSpecWorkflowSchemaStatus>,
  props: { defaultForNewProjects?: boolean; onDefaultChange?: (v: boolean) => void } = {},
) {
  const map = new Map<string, OpenSpecData>(
    Object.entries(statuses).map(([cwd, workflowSchema]) => [
      cwd,
      { initialized: true, changes: [], workflowSchema } as OpenSpecData,
    ]),
  );
  return render(
    <OpenSpecMapContext.Provider value={map}>
      <OpenSpecWorkflowSchemaSection
        defaultForNewProjects={props.defaultForNewProjects ?? false}
        onDefaultChange={props.onDefaultChange ?? (() => {})}
      />
    </OpenSpecMapContext.Provider>,
  );
}

const posts = () =>
  (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url, init]) => String(url).includes("/api/openspec/workflow-schema") && (init as RequestInit)?.method === "POST",
  );

let schemaResponse: { status: number; body: unknown };

beforeEach(() => {
  schemaResponse = {
    status: 200,
    body: {
      success: true,
      data: { ok: true, status: "current", configured: "pi-spec-driven", written: ["openspec/config.yaml"], worktree: { isWorktree: true, branch: "wt-1" } },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/git/worktrees")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              worktrees: [
                { path: "/repo", branch: "develop", sha: "a", bare: false, detached: false, isMain: true },
                { path: CWD, branch: "wt-1", sha: "b", bare: false, detached: false, isMain: false },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/openspec/workflow-schema")) {
        return new Response(JSON.stringify(schemaResponse.body), { status: schemaResponse.status });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const buttonsFor = (cwd: string) =>
  within(screen.getByTestId(`workflow-schema-row-${cwd}`))
    .queryAllByRole("button")
    .map((b) => b.getAttribute("data-action"));

describe("OpenSpecWorkflowSchemaSection", () => {
  it("#F5 default switch reflects the prop and reports changes without any request", () => {
    const onDefaultChange = vi.fn();
    renderSection({}, { defaultForNewProjects: false, onDefaultChange });
    const sw = screen.getByRole("switch", { name: /default for new projects/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(onDefaultChange).toHaveBeenCalledWith(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("#F6 Enable: dialog lists paths + worktree branch; cancel → no POST; confirm → one POST", async () => {
    renderSection({ [CWD]: status() });
    fireEvent.click(screen.getByTestId(`workflow-schema-enable-${CWD}`));

    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByText(/openspec\/schemas\/pi-spec-driven\//)).toBeTruthy();
    expect(within(dialog).getByText(/openspec\/config\.yaml/)).toBeTruthy();
    expect(within(dialog).getByText(/\.openspec\.yaml/)).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByTestId("workflow-schema-branch").textContent).toContain("wt-1"));

    fireEvent.click(within(dialog).getByTestId("workflow-schema-cancel"));
    expect(screen.queryByTestId("workflow-schema-confirm")).toBeNull();
    expect(posts()).toHaveLength(0);

    fireEvent.click(screen.getByTestId(`workflow-schema-enable-${CWD}`));
    fireEvent.click(await screen.findByTestId("workflow-schema-confirm-action"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toMatchObject({ cwd: CWD, action: "enable" });
    // Result is reported inline, and no Save Bar machinery is involved.
    await waitFor(() => expect(screen.getByTestId(`workflow-schema-result-${CWD}`).textContent).toContain("openspec/config.yaml"));
    expect(screen.queryByTestId("save-bar")).toBeNull();
  });

  it("#F6 a 422 refusal is shown, not thrown away", async () => {
    schemaResponse = {
      status: 422,
      body: { success: false, error: "cannot enable while the schema is incompatible", data: { ok: false, status: "incompatible", configured: null, written: [], worktree: { isWorktree: false, branch: null } } },
    };
    renderSection({ [CWD]: status() });
    fireEvent.click(screen.getByTestId(`workflow-schema-enable-${CWD}`));
    fireEvent.click(await screen.findByTestId("workflow-schema-confirm-action"));
    await waitFor(() =>
      expect(screen.getByTestId(`workflow-schema-result-${CWD}`).textContent).toContain("cannot enable while the schema is incompatible"),
    );
  });

  // #F7 — allowed-state table (client gating mirrors it).
  const TABLE: Array<[string, Partial<OpenSpecWorkflowSchemaStatus>, string[]]> = [
    ["none, not enabled", { generated: "none", configured: "spec-driven" }, ["enable"]],
    ["none, enabled", { generated: "none", configured: "pi-spec-driven" }, ["disable", "update"]],
    ["current, not enabled", { generated: "current", configured: "spec-driven" }, ["enable", "update", "remove"]],
    ["current, enabled", { generated: "current", configured: "pi-spec-driven" }, ["disable", "update", "remove"]],
    ["outdated, enabled", { generated: "outdated", configured: "pi-spec-driven" }, ["disable", "update", "remove"]],
    ["newer, not enabled", { generated: "newer", configured: null }, ["enable", "remove"]],
    ["conflict, not enabled", { generated: "conflict", configured: null }, ["enable", "remove"]],
    ["incompatible", { generated: "incompatible", configured: null }, ["remove"]],
    ["unmanaged", { generated: "unmanaged", configured: null }, ["adopt"]],
    ["current, enabled, unpinned", { generated: "current", configured: "pi-spec-driven", unpinnedChanges: ["x"] }, ["disable", "update", "pin", "remove"]],
  ];
  it.each(TABLE)("#F7 buttons for %s", (_name, over, expected) => {
    renderSection({ [CWD]: status(over) });
    expect(buttonsFor(CWD).sort()).toEqual([...expected].sort());
  });

  it("#F7 Adopt selector lists spec-driven (preselected) and the project default, never anything else", async () => {
    renderSection({ [CWD]: status({ generated: "unmanaged", configured: "team-flow" }) });
    fireEvent.click(screen.getByTestId(`workflow-schema-adopt-${CWD}`));
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByText(/hand customizations are discarded/i)).toBeTruthy();
    const select = within(dialog).getByTestId("workflow-schema-previous-default") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["spec-driven", "team-flow"]);
    expect(select.value).toBe("spec-driven");
    fireEvent.click(within(dialog).getByTestId("workflow-schema-confirm-action"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toMatchObject({
      action: "adopt",
      confirm: true,
      previousDefault: "spec-driven",
    });
  });

  it("#F7 Update states the affected change count", async () => {
    renderSection({
      [CWD]: status({ generated: "outdated", configured: "pi-spec-driven", affectedChanges: ["a", "b", "c"] }),
    });
    fireEvent.click(screen.getByTestId(`workflow-schema-update-${CWD}`));
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByTestId("workflow-schema-affected").textContent).toContain("3");
  });

  it("#F7 Pin posts the unpinned changes with the chosen target", async () => {
    renderSection({
      [CWD]: status({ generated: "current", configured: "pi-spec-driven", unpinnedChanges: ["foo", "bar"] }),
    });
    fireEvent.click(screen.getByTestId(`workflow-schema-pin-${CWD}`));
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByText(/changes\/foo\/\.openspec\.yaml/)).toBeTruthy();
    fireEvent.change(within(dialog).getByTestId("workflow-schema-pin-target"), { target: { value: "spec-driven" } });
    fireEvent.click(within(dialog).getByTestId("workflow-schema-confirm-action"));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toMatchObject({
      action: "pin",
      pinTo: "spec-driven",
      changes: ["foo", "bar"],
    });
  });
});
