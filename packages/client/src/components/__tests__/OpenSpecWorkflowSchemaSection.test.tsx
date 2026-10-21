/**
 * OpenSpecWorkflowSchemaSection — change: add-pi-spec-driven-schema.
 * test-plan #F6 (enable confirm), #F7 (state-gated buttons + selector), #F5
 * section half (default switch is a prop-driven draft control).
 * UX redesign (approved mockup): #U2–#U8, #U11.
 */

import type { OpenSpecData, OpenSpecWorkflowSchemaStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenSpecMapContext } from "../../lib/openspec/OpenSpecMapContext.js";
import { OpenSpecWorkflowSchemaSection } from "../openspec/OpenSpecWorkflowSchemaSection.js";

const CWD = "/repo/a";

function status(over: Partial<OpenSpecWorkflowSchemaStatus> = {}): OpenSpecWorkflowSchemaStatus {
  return { configured: null, generated: "none", missing: false, unpinnedChanges: [], affectedChanges: [], projectSchemas: [], ...over };
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
/** When set, the workflow-schema POST waits for it (held-pending request). */
let schemaGate: Promise<void> | null;

beforeEach(() => {
  schemaGate = null;
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
        if (schemaGate !== null) await schemaGate;
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

const rowOf = (cwd: string) => screen.getByTestId(`workflow-schema-row-${cwd}`);
const menuButtonOf = (cwd: string) =>
  within(rowOf(cwd)).queryByRole("button", { name: /more actions/i }) as HTMLButtonElement | null;
const openMenu = (cwd: string) => {
  const mb = menuButtonOf(cwd);
  if (!mb) throw new Error(`no More actions menu for ${cwd}`);
  fireEvent.click(mb);
  return screen.getByRole("menu");
};
/** Every action a card offers: the recommended button plus the menu items. */
const buttonsFor = (cwd: string) => {
  if (menuButtonOf(cwd)) openMenu(cwd);
  return [...rowOf(cwd).querySelectorAll("[data-action]")].map((b) => b.getAttribute("data-action"));
};
/** Click an action wherever it lives (card button, else menu item). */
const choose = (cwd: string, action: string) => {
  const id = `workflow-schema-${action}-${cwd}`;
  if (!screen.queryByTestId(id)) openMenu(cwd);
  fireEvent.click(screen.getByTestId(id));
};

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
    expect(within(within(dialog).getByTestId("workflow-schema-paths")).getByText(/\.openspec\.yaml/)).toBeTruthy();
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
    ["current, enabled", { generated: "current", configured: "pi-spec-driven" }, ["disable", "update"]],
    ["outdated, enabled", { generated: "outdated", configured: "pi-spec-driven" }, ["disable", "update"]],
    ["newer, not enabled", { generated: "newer", configured: null }, ["enable", "remove"]],
    ["conflict, not enabled", { generated: "conflict", configured: null }, ["enable", "remove"]],
    ["incompatible", { generated: "incompatible", configured: null }, ["remove"]],
    ["unmanaged", { generated: "unmanaged", configured: null }, ["adopt"]],
    ["current, enabled, unpinned", { generated: "current", configured: "pi-spec-driven", unpinnedChanges: ["x"] }, ["disable", "update", "pin"]],
  ];
  it.each(TABLE)("#F7 buttons for %s", (_name, over, expected) => {
    renderSection({ [CWD]: status(over) });
    expect(buttonsFor(CWD).sort()).toEqual([...expected].sort());
  });

  it("#F7 Adopt selector lists spec-driven (preselected) and the project default, never anything else", async () => {
    renderSection({ [CWD]: status({ generated: "unmanaged", configured: "team-flow", projectSchemas: ["team-flow"] }) });
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

  it("#F9 Update names the patch-2 impact: how many affected changes need a declaration", async () => {
    renderSection({
      [CWD]: status({
        generated: "outdated",
        configured: "pi-spec-driven",
        affectedChanges: ["a", "b", "c", "d"],
        undeclaredChanges: ["a", "b", "d"],
        raisesToDependencies: true,
      }),
    });
    fireEvent.click(screen.getByTestId(`workflow-schema-update-${CWD}`));
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByTestId("workflow-schema-affected").textContent).toContain("Affects 4 active changes");
    const impact = within(dialog).getByTestId("workflow-schema-dependencies-impact").textContent ?? "";
    expect(impact).toContain("3 of 4");
    expect(impact).toMatch(/return to planning/);
  });

  it("#F9 no impact line when the update does not raise the stamp to the dependencies patch (outdated for the CLI base only)", async () => {
    renderSection({
      [CWD]: status({
        generated: "outdated",
        configured: "pi-spec-driven",
        affectedChanges: ["a", "b"],
        undeclaredChanges: ["a", "b"],
        raisesToDependencies: false,
      }),
    });
    fireEvent.click(screen.getByTestId(`workflow-schema-update-${CWD}`));
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).queryByTestId("workflow-schema-dependencies-impact")).toBeNull();
  });

  it("#F9 no impact line when the server has not reported undeclared changes or none are missing", async () => {
    renderSection({ [CWD]: status({ generated: "outdated", configured: "pi-spec-driven", affectedChanges: ["a"] }) });
    fireEvent.click(screen.getByTestId(`workflow-schema-update-${CWD}`));
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).queryByTestId("workflow-schema-dependencies-impact")).toBeNull();
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

  // ── UX redesign: #U2 Remove hidden while enabled ─────────────────────────
  it("#U2 Remove is absent in the four pi-spec-driven rows and last (after a separator) in the two team-flow rows", () => {
    const rows: Array<[string, Partial<OpenSpecWorkflowSchemaStatus>, boolean]> = [
      ["/p/pi-current", { configured: "pi-spec-driven", generated: "current" }, false],
      ["/p/pi-outdated", { configured: "pi-spec-driven", generated: "outdated" }, false],
      ["/p/pi-newer", { configured: "pi-spec-driven", generated: "newer" }, false],
      ["/p/pi-conflict", { configured: "pi-spec-driven", generated: "conflict" }, false],
      ["/p/tf-current", { configured: "team-flow", generated: "current" }, true],
      ["/p/tf-newer", { configured: "team-flow", generated: "newer" }, true],
    ];
    renderSection(Object.fromEntries(rows.map(([cwd, over]) => [cwd, status(over)])));
    for (const [cwd, , hasRemove] of rows) {
      const menu = openMenu(cwd);
      const items = within(menu).getAllByRole("menuitem");
      const ids = items.map((i) => i.getAttribute("data-testid"));
      if (hasRemove) {
        expect(ids[ids.length - 1]).toBe(`workflow-schema-remove-${cwd}`);
        const sep = within(menu).getByRole("separator");
        expect(sep.nextElementSibling).toBe(items[items.length - 1]);
      } else {
        expect(ids).not.toContain(`workflow-schema-remove-${cwd}`);
        expect(within(menu).queryByRole("separator")).toBeNull();
      }
      fireEvent.keyDown(menu, { key: "Escape" });
    }
  });

  // ── #U3 one recommended action + APG menu button ─────────────────────────
  it("#U3 one recommended action; menu button follows the APG menu pattern", () => {
    renderSection({ [CWD]: status({ configured: "team-flow", generated: "outdated" }) });
    const row = rowOf(CWD);
    expect(within(row).getByText("Disabled, files kept")).toBeTruthy();
    const actions = [...row.querySelectorAll("[data-action]")];
    expect(actions).toHaveLength(1);
    expect(actions[0].textContent).toBe("Enable…");

    const mb = menuButtonOf(CWD) as HTMLButtonElement;
    expect(mb.getAttribute("aria-haspopup")).toBe("menu");
    expect(mb.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(mb);
    expect(mb.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Update schema…", "Remove schema files…"]);
    expect(items[0].getAttribute("data-testid")).toBe(`workflow-schema-update-${CWD}`);
    expect(items[1].getAttribute("data-testid")).toBe(`workflow-schema-remove-${CWD}`);

    // Opening focuses the first item; ArrowDown moves to the next.
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(mb.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(mb);
  });

  // ── #U4 only the acting card is busy ─────────────────────────────────────
  it("#U4 only the acting card is busy while its POST is pending", async () => {
    let release!: () => void;
    schemaGate = new Promise<void>((r) => {
      release = r;
    });
    renderSection({ "/repo/a": status({ configured: "spec-driven" }), "/repo/b": status({ configured: "spec-driven" }) });
    fireEvent.click(screen.getByTestId("workflow-schema-enable-/repo/a"));
    fireEvent.click(await screen.findByTestId("workflow-schema-confirm-action"));

    await waitFor(() => expect(rowOf("/repo/a").getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByTestId("workflow-schema-enable-/repo/a").textContent).toContain("Enabling…");
    expect(rowOf("/repo/b").getAttribute("aria-busy")).toBeNull();
    const b = screen.getByTestId("workflow-schema-enable-/repo/b") as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    expect(b.getAttribute("aria-disabled")).not.toBe("true");

    release();
    await waitFor(() => expect(rowOf("/repo/a").getAttribute("aria-busy")).toBeNull());
  });

  // ── #U5 result callouts ──────────────────────────────────────────────────
  async function runEnable(over: Partial<OpenSpecWorkflowSchemaStatus> = { configured: "spec-driven" }) {
    renderSection({ [CWD]: status(over) });
    fireEvent.click(screen.getByTestId(`workflow-schema-enable-${CWD}`));
    fireEvent.click(await screen.findByTestId("workflow-schema-confirm-action"));
    return await screen.findByTestId(`workflow-schema-result-${CWD}`);
  }
  const PATHS = [
    "openspec/schemas/pi-spec-driven",
    "openspec/changes/add-session-step-table/.openspec.yaml",
    "openspec/changes/add-web-chat-plugin/.openspec.yaml",
    "openspec/config.yaml",
  ];

  it("#U5 success: role=status, count + branch, never-commits sentence, Show files (4)", async () => {
    schemaResponse = {
      status: 200,
      body: { success: true, data: { ok: true, status: "current", configured: "pi-spec-driven", written: PATHS, worktree: { isWorktree: true, branch: "os/add-request-access-remedy" } } },
    };
    const callout = await runEnable();
    expect(callout.getAttribute("role")).toBe("status");
    expect(callout.textContent).toContain("4 paths written on branch os/add-request-access-remedy");
    expect(callout.textContent).toContain("The dashboard does not commit");
    const details = callout.querySelector("details") as HTMLDetailsElement;
    expect(within(details).getByText("Show files (4)")).toBeTruthy();
    for (const path of PATHS) expect(within(details).getByText(path)).toBeTruthy();
  });

  it("#U5 no-op: neutral 'Nothing to change.' with the server's reason", async () => {
    schemaResponse = {
      status: 200,
      body: { success: true, data: { ok: true, status: "none", configured: "spec-driven", written: [], warnings: ["the default is spec-driven, not pi-spec-driven"], worktree: { isWorktree: false, branch: null } } },
    };
    const callout = await runEnable();
    expect(callout.getAttribute("role")).toBe("status");
    expect(callout.textContent).toContain("Nothing to change.");
    expect(callout.textContent).toContain("The default is spec-driven, not pi-spec-driven.");
  });

  it("#U5 partial: warning role=alert names the next step and lists the paths", async () => {
    schemaResponse = {
      status: 500,
      body: { success: false, error: "enable stopped part-way: EACCES", data: { ok: false, partial: true, status: "current", configured: "spec-driven", written: PATHS.slice(0, 2), worktree: { isWorktree: false, branch: null } } },
    };
    const callout = await runEnable();
    expect(callout.getAttribute("role")).toBe("alert");
    expect(callout.textContent).toContain("Run Enable again to finish");
    expect(callout.textContent).toContain("enable stopped part-way: EACCES");
    expect(callout.textContent).toContain(PATHS[1]);
  });

  it("#U5 refusal: error role=alert with the server message and the card's current state", async () => {
    schemaResponse = {
      status: 422,
      body: { success: false, error: "the stamp records previousDefault spec-driven", data: { ok: false, status: "none", configured: "spec-driven", written: [], worktree: { isWorktree: false, branch: null } } },
    };
    const callout = await runEnable();
    expect(callout.getAttribute("role")).toBe("alert");
    expect(callout.textContent).toContain("the stamp records previousDefault spec-driven");
    expect(callout.textContent).toContain("Current state: Not enabled");
  });

  it("#U5 409: info callout 'Another action is running for this project.'", async () => {
    schemaResponse = { status: 409, body: { success: false, error: "an OpenSpec init or workflow-schema action is already in flight" } };
    const callout = await runEnable();
    expect(callout.getAttribute("role")).toBe("status");
    expect(callout.textContent).toContain("Another action is running for this project.");
  });

  // ── #U6 Pin result names skipped changes ─────────────────────────────────
  it("#U6 a Pin result names the skipped change", async () => {
    schemaResponse = {
      status: 200,
      body: {
        success: true,
        data: {
          ok: true,
          status: "current",
          configured: "pi-spec-driven",
          written: ["openspec/changes/a/.openspec.yaml", "openspec/changes/b/.openspec.yaml"],
          skipped: ["absorb-service-secrets-into-vault"],
          worktree: { isWorktree: false, branch: null },
        },
      },
    };
    renderSection({ [CWD]: status({ configured: "pi-spec-driven", generated: "current", unpinnedChanges: ["a", "b", "absorb-service-secrets-into-vault"] }) });
    expect(screen.getByTestId(`workflow-schema-pin-${CWD}`).textContent).toBe("Pin 3 changes…");
    fireEvent.click(screen.getByTestId(`workflow-schema-pin-${CWD}`));
    fireEvent.click(await screen.findByTestId("workflow-schema-confirm-action"));
    const callout = await screen.findByTestId(`workflow-schema-result-${CWD}`);
    expect(callout.textContent).toContain("1 change skipped");
    expect(callout.textContent).toContain("absorb-service-secrets-into-vault");
  });

  // ── #U7 dialog per action ────────────────────────────────────────────────
  const paths = (dialog: HTMLElement) =>
    within(within(dialog).getByTestId("workflow-schema-paths"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
  const confirmBtn = () => screen.getByTestId("workflow-schema-confirm-action");

  it("#U7 enable: title, confirm, paths-only list + help text", async () => {
    renderSection({ "/p/deck3d": status({ configured: "spec-driven", generated: "none" }) });
    choose("/p/deck3d", "enable");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByRole("heading", { name: "Enable pi-spec-driven in deck3d?" })).toBeTruthy();
    expect(within(dialog).getByText("Files written")).toBeTruthy();
    expect(paths(dialog)).toEqual(["openspec/schemas/pi-spec-driven/", "openspec/config.yaml", "openspec/changes/*/.openspec.yaml"]);
    expect(within(dialog).getByText(/stands for each active change/i)).toBeTruthy();
    expect(confirmBtn().textContent).toBe("Enable");
    expect(confirmBtn().className).toContain("bg-[var(--accent-solid)]");
    expect(within(dialog).queryByTestId("workflow-schema-branch")).toBeNull();
  });

  it("#U7 update: names 5 affected changes and 'and 2 more'", async () => {
    const affected = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    renderSection({ "/p/pi-agent-dashboard": status({ configured: "pi-spec-driven", generated: "outdated", affectedChanges: affected }) });
    choose("/p/pi-agent-dashboard", "update");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByRole("heading", { name: "Update pi-spec-driven in pi-agent-dashboard?" })).toBeTruthy();
    const aff = within(dialog).getByTestId("workflow-schema-affected");
    for (const n of affected.slice(0, 5)) expect(within(aff).getByText(n)).toBeTruthy();
    expect(within(aff).queryByText("c6")).toBeNull();
    expect(aff.textContent).toContain("Affects 7 active changes");
    expect(within(aff).getByText("and 2 more")).toBeTruthy();
    expect(confirmBtn().textContent).toBe("Update schema");
  });

  it("#U7 adopt: danger confirm and a warning callout", async () => {
    renderSection({ "/p/pi-9router-proxy": status({ configured: "spec-driven", generated: "unmanaged" }) });
    choose("/p/pi-9router-proxy", "adopt");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByRole("heading", { name: "Adopt pi-spec-driven in pi-9router-proxy?" })).toBeTruthy();
    expect(confirmBtn().textContent).toBe("Adopt and regenerate");
    // Destructive confirm = the danger intent: red tint triple, no raw red fill (align-ui-contract-recipes).
    expect(confirmBtn().className).toContain("bg-[var(--tint-red-bg)]");
    expect(confirmBtn().className).not.toContain("bg-red-600");
    expect(within(dialog).getByText(/hand customizations are discarded/i).closest("[data-severity]")?.getAttribute("data-severity")).toBe("warning");
  });

  it("#U7 pin in a worktree: branch info callout + 'Pin 3 changes'", async () => {
    renderSection({ [CWD]: status({ configured: "pi-spec-driven", generated: "current", unpinnedChanges: ["x", "y", "z"] }) });
    choose(CWD, "pin");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByRole("heading", { name: "Pin 3 changes in a?" })).toBeTruthy();
    const branch = await within(dialog).findByTestId("workflow-schema-branch");
    expect(branch.textContent).toContain("wt-1");
    expect(branch.textContent).toContain("never commits");
    expect(branch.closest("[data-severity]")?.getAttribute("data-severity")).toBe("info");
    expect(paths(dialog)).toEqual(["openspec/changes/x/.openspec.yaml", "openspec/changes/y/.openspec.yaml", "openspec/changes/z/.openspec.yaml"]);
    expect(confirmBtn().textContent).toBe("Pin 3 changes");
  });

  it("#U7 stamp-less disable: title + 'Disable'", async () => {
    renderSection({ "/p/park-here": status({ configured: "pi-spec-driven", generated: "none", missing: true }) });
    choose("/p/park-here", "disable");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByRole("heading", { name: "Disable pi-spec-driven in park-here?" })).toBeTruthy();
    expect(confirmBtn().textContent).toBe("Disable");
    expect(paths(dialog)).toEqual(["openspec/config.yaml"]);
  });

  it("#U7 remove: danger confirm, 'Files removed', warning callout", async () => {
    renderSection({ "/p/judo-ng": status({ configured: "team-flow", generated: "current" }) });
    choose("/p/judo-ng", "remove");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    expect(within(dialog).getByRole("heading", { name: "Remove pi-spec-driven from judo-ng?" })).toBeTruthy();
    expect(within(dialog).getByText("Files removed")).toBeTruthy();
    expect(paths(dialog)).toEqual(["openspec/schemas/pi-spec-driven/"]);
    expect(confirmBtn().textContent).toBe("Remove schema files");
    // Destructive confirm = the danger intent: red tint triple, no raw red fill (align-ui-contract-recipes).
    expect(confirmBtn().className).toContain("bg-[var(--tint-red-bg)]");
    expect(confirmBtn().className).not.toContain("bg-red-600");
    expect(within(dialog).getByText(/unmerged branches may still pin/i).closest("[data-severity]")?.getAttribute("data-severity")).toBe("warning");
  });

  // ── #U8 previous-default field ───────────────────────────────────────────
  it("#U8 Update with a stamp preselects 'Keep recorded value'; field is labelled with help text", async () => {
    renderSection({ [CWD]: status({ configured: "pi-spec-driven", generated: "current" }) });
    choose(CWD, "update");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    const select = within(dialog).getByLabelText("Previous default") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("Keep recorded value");
    const help = document.getElementById(select.getAttribute("aria-describedby") as string);
    expect(help?.textContent).toMatch(/stamp/i);
  });

  it("#U8 Adopt lists exactly spec-driven + projectSchemas, preselecting spec-driven", async () => {
    renderSection({ [CWD]: status({ configured: "spec-driven", generated: "unmanaged", projectSchemas: ["team-flow"] }) });
    choose(CWD, "adopt");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    const select = within(dialog).getByLabelText("Previous default") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["spec-driven", "team-flow"]);
    expect(select.value).toBe("spec-driven");
  });

  it("#U8 stamp-less Disable preselects spec-driven", async () => {
    renderSection({ [CWD]: status({ configured: "pi-spec-driven", generated: "none", missing: true }) });
    choose(CWD, "disable");
    const dialog = await screen.findByTestId("workflow-schema-confirm");
    const select = within(dialog).getByLabelText("Previous default") as HTMLSelectElement;
    expect(select.value).toBe("spec-driven");
    expect(document.getElementById(select.getAttribute("aria-describedby") as string)).toBeTruthy();
  });

  // ── #U11 intro + empty state ─────────────────────────────────────────────
  it("#U11 empty state explains when a project appears; intro mentions the 'Not needed' design skip", () => {
    renderSection({});
    expect(screen.getByTestId("workflow-schema-empty").textContent).toBe(
      "No OpenSpec projects yet. A project appears here once the dashboard has polled a folder that contains openspec/.",
    );
    expect(screen.getByTestId("openspec-workflow-schema-settings").textContent).toContain("“Not needed” design skip");
  });
});
