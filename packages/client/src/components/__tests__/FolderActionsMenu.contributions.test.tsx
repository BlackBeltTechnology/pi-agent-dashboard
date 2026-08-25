/**
 * `FolderActionsMenu` after the slot-pill actions moved in: the five-group verb
 * taxonomy, badge + disabled rendering, and the plugin contribution merge.
 *
 * Scenarios: test-plan #E5, #E6, #E7, #E15, #E16, #E17, #E18, #F3, #X2.
 * See change: move-slot-actions-to-menu.
 */

import {
  CurrentPluginLayer,
  createFolderMenuStore,
  type FolderMenuContribution,
  FolderMenuProvider,
  useFolderMenuItem,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiPin, mdiPlus, mdiRefresh } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderActionsMenu, type FolderMenuItem } from "../folder/FolderActionsMenu.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => false }));

afterEach(cleanup);

const CWD = "/a/b";

function contribution(over: Partial<FolderMenuContribution> = {}): FolderMenuContribution {
  return { id: "c", group: "create", label: "Contributed", icon: mdiPlus, onSelect: () => {}, ...over };
}

function Section({ pluginId, item }: { pluginId: string; item: FolderMenuContribution }) {
  return (
    <CurrentPluginLayer pluginId={pluginId}>
      <Registrar item={item} />
    </CurrentPluginLayer>
  );
}
function Registrar({ item }: { item: FolderMenuContribution }) {
  useFolderMenuItem(CWD, item);
  return null;
}

function Harness({
  items = [],
  store,
  children,
  startOpen = true,
}: {
  items?: FolderMenuItem[];
  store: ReturnType<typeof createFolderMenuStore>;
  children?: React.ReactNode;
  startOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(startOpen);
  return (
    <FolderMenuProvider store={store}>
      <FolderActionsMenu cwd={CWD} items={items} open={open} onOpenChange={setOpen} />
      {children}
    </FolderMenuProvider>
  );
}

function groupOrder(): string[] {
  const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
  return Array.from(panel.querySelectorAll("[data-testid^='folder-menu-group-']")).map(
    (n) => n.getAttribute("data-testid")!,
  );
}

function itemOrder(): string[] {
  const panel = screen.getByTestId(`folder-actions-menu-panel-${CWD}`);
  return Array.from(panel.querySelectorAll("[data-testid^='folder-menu-item-']")).map(
    (n) => n.getAttribute("data-testid")!.replace("folder-menu-item-", ""),
  );
}

describe("five-group verb taxonomy (test-plan #E5, #E7)", () => {
  it("renders groups in the fixed host order, skipping empty ones", () => {
    render(
      <Harness
        store={createFolderMenuStore()}
        items={[
          { id: "reindex", group: "maintenance", label: "Reindex", icon: mdiRefresh, onSelect: () => {} },
          { id: "pin", group: "directory", label: "Pin", icon: mdiPin, onSelect: () => {} },
          { id: "specs", group: "open", label: "OpenSpec specs", icon: mdiPin, onSelect: () => {} },
          { id: "new-goal", group: "create", label: "New goal", icon: mdiPlus, onSelect: () => {} },
        ]}
      />,
    );
    expect(groupOrder()).toEqual([
      "folder-menu-group-directory",
      "folder-menu-group-create",
      "folder-menu-group-open",
      "folder-menu-group-maintenance",
    ]);
  });

  it("E5/E6: contributions follow host items and order by pluginId then id, whatever the mount order", () => {
    const store = createFolderMenuStore();
    const goal = <Section key="g" pluginId="goal-plugin" item={contribution({ id: "new-goal" })} />;
    const automation = (
      <Section key="a" pluginId="automation-plugin" item={contribution({ id: "new-automation" })} />
    );
    const host: FolderMenuItem[] = [
      { id: "host-create", group: "create", label: "Host create", icon: mdiPlus, onSelect: () => {} },
    ];
    const { unmount } = render(
      <Harness store={store} items={host}>
        {[goal, automation]}
      </Harness>,
    );
    const forward = itemOrder();
    unmount();

    render(
      <Harness store={createFolderMenuStore()} items={host}>
        {[automation, goal]}
      </Harness>,
    );
    expect(itemOrder()).toEqual(forward);
    expect(forward).toEqual(["host-create", "new-automation", "new-goal"]);
  });

  it("E7: a group with no items renders no heading", () => {
    render(
      <Harness
        store={createFolderMenuStore()}
        items={[{ id: "pin", group: "directory", label: "Pin", icon: mdiPin, onSelect: () => {} }]}
      />,
    );
    expect(screen.queryByTestId("folder-menu-group-workspace")).toBeNull();
    expect(screen.queryByTestId("folder-menu-group-maintenance")).toBeNull();
  });
});

describe("badge and disabled rendering (test-plan #E17, #E18)", () => {
  it("E17: a badge renders and forms part of the item's accessible name", () => {
    render(
      <Harness
        store={createFolderMenuStore()}
        items={[
          { id: "kb-reindex", group: "maintenance", label: "Reindex", icon: mdiRefresh, badge: "3 stale", onSelect: () => {} },
        ]}
      />,
    );
    const item = screen.getByTestId("folder-menu-item-kb-reindex");
    expect(item.textContent).toContain("3 stale");
    expect(item.textContent).toContain("Reindex");
  });

  it("E17: a disabled item is exposed as a disabled control", () => {
    render(
      <Harness
        store={createFolderMenuStore()}
        items={[
          { id: "kb-reindex", group: "maintenance", label: "Indexing…", icon: mdiRefresh, disabled: true, onSelect: () => {} },
        ]}
      />,
    );
    const item = screen.getByTestId("folder-menu-item-kb-reindex");
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  it("E18: activating a disabled item does not run its callback and leaves the menu open", () => {
    const onSelect = vi.fn();
    render(
      <Harness
        store={createFolderMenuStore()}
        items={[
          { id: "kb-reindex", group: "maintenance", label: "Indexing…", icon: mdiRefresh, disabled: true, onSelect },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-menu-item-kb-reindex"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId(`folder-actions-menu-panel-${CWD}`)).toBeTruthy();
  });

  it("an enabled item still fires and closes the menu", () => {
    const onSelect = vi.fn();
    render(
      <Harness
        store={createFolderMenuStore()}
        items={[{ id: "refresh", group: "maintenance", label: "Refresh", icon: mdiRefresh, onSelect }]}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-menu-item-refresh"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`folder-actions-menu-panel-${CWD}`)).toBeNull();
  });
});

describe("contribution hygiene (test-plan #E15, #E16, #X2)", () => {
  it("E15: a contribution missing a required field is skipped; siblings still render", () => {
    const store = createFolderMenuStore();
    render(
      <Harness store={store}>
        <Section pluginId="p" item={contribution({ id: "good" })} />
        <Section pluginId="p" item={contribution({ id: "bad", label: undefined as never })} />
      </Harness>,
    );
    expect(itemOrder()).toEqual(["good"]);
  });

  it("E16: a contribution naming an unknown group is dropped, not rendered ungrouped", () => {
    const store = createFolderMenuStore();
    render(
      <Harness store={store}>
        <Section pluginId="p" item={contribution({ id: "good" })} />
        <Section pluginId="p" item={contribution({ id: "alien", group: "kb" as never })} />
      </Harness>,
    );
    expect(itemOrder()).toEqual(["good"]);
  });

  it("X2: a contribution whose onSelect throws leaves the menu and its siblings working", () => {
    const store = createFolderMenuStore();
    const sibling = vi.fn();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Harness
        store={store}
        items={[{ id: "sibling", group: "maintenance", label: "Refresh", icon: mdiRefresh, onSelect: sibling }]}
      >
        <Section
          pluginId="p"
          item={contribution({
            id: "boom",
            onSelect: () => {
              throw new Error("plugin blew up");
            },
          })}
        />
      </Harness>,
    );
    expect(() => fireEvent.click(screen.getByTestId("folder-menu-item-boom"))).not.toThrow();
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    fireEvent.click(screen.getByTestId("folder-menu-item-sibling"));
    expect(sibling).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("deregistration while the menu is open (test-plan #X3, L1 mirror)", () => {
  it("the item disappears from the OPEN menu and its callback is never reachable again", () => {
    const store = createFolderMenuStore();
    const onSelect = vi.fn();
    function Tree({ mounted }: { mounted: boolean }) {
      return (
        <Harness store={store}>
          {mounted ? <Section pluginId="kb-plugin" item={contribution({ id: "kb-reindex", onSelect })} /> : null}
        </Harness>
      );
    }
    const { rerender } = render(<Tree mounted />);
    expect(screen.getByTestId("folder-menu-item-kb-reindex")).toBeTruthy();
    // The plugin's section unmounts (plugin disabled) while the menu is open.
    rerender(<Tree mounted={false} />);
    expect(screen.getByTestId(`folder-actions-menu-panel-${CWD}`)).toBeTruthy();
    expect(screen.queryByTestId("folder-menu-item-kb-reindex")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("late registration (test-plan #F3, L1 mirror)", () => {
  it("an open menu converges to include an item registered after it opened", () => {
    const store = createFolderMenuStore();
    function Tree({ late }: { late: boolean }) {
      return (
        <Harness store={store}>{late ? <Section pluginId="kb-plugin" item={contribution({ id: "kb-reindex" })} /> : null}</Harness>
      );
    }
    const { rerender } = render(<Tree late={false} />);
    expect(screen.queryByTestId("folder-menu-item-kb-reindex")).toBeNull();
    rerender(<Tree late />);
    expect(screen.getByTestId("folder-menu-item-kb-reindex")).toBeTruthy();
    expect(screen.getByTestId(`folder-actions-menu-panel-${CWD}`)).toBeTruthy();
  });
});
