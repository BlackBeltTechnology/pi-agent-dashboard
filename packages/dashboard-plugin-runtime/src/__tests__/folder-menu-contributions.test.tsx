/**
 * Folder actions menu contribution registry — the bridge that lets a slot
 * section (rendered in the pill grid) put an item in the folder header's menu.
 *
 * The sections and the menu are SIBLINGS, so the registry is an external store
 * read with `useSyncExternalStore`; these tests pin the parts that are silent
 * when they break: unmount deregistration, remount identity, cross-plugin
 * collisions and the malformed/unknown-group drops.
 *
 * Scenarios: test-plan #E5, #E6, #E15, #E16, #E20, #E21, #F1, #F2, #F5.
 * See change: move-slot-actions-to-menu.
 */

import { mdiPlus } from "@mdi/js";
import { act, cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFolderMenuStore,
  FOLDER_MENU_GROUPS,
  type FolderMenuContribution,
  FolderMenuProvider,
  isValidFolderMenuContribution,
  selectFolderMenuItems,
  useFolderMenuItem,
  useFolderMenuItems,
  useFolderMenuRefresher,
} from "../folder-menu-contributions.js";
import { CurrentPluginLayer } from "../plugin-context.js";

afterEach(cleanup);

const SCOPE = "/repo/a";

function contribution(over: Partial<FolderMenuContribution> = {}): FolderMenuContribution {
  return {
    id: "new-thing",
    group: "create",
    label: "New thing",
    icon: mdiPlus,
    onSelect: () => {},
    ...over,
  };
}

/** A section that registers one item for as long as it is mounted. */
function Section({
  pluginId,
  scope,
  item,
}: {
  pluginId: string;
  scope: string | null;
  item: FolderMenuContribution;
}) {
  return (
    <CurrentPluginLayer pluginId={pluginId}>
      <Registrar scope={scope} item={item} />
    </CurrentPluginLayer>
  );
}

function Registrar({ scope, item }: { scope: string | null; item: FolderMenuContribution }) {
  useFolderMenuItem(scope, item);
  return null;
}

/** A menu stand-in that renders the ids it currently sees, in order. */
function MenuProbe({ onRender }: { onRender?: () => void }) {
  const items = useFolderMenuItems(SCOPE);
  onRender?.();
  return <div data-testid="probe">{items.map((i) => `${i.pluginId}:${i.id}:${i.label}`).join("|")}</div>;
}

function renderTree(store: ReturnType<typeof createFolderMenuStore>, children: React.ReactNode) {
  return render(<FolderMenuProvider store={store}>{children}</FolderMenuProvider>);
}

// ── Taxonomy + pure helpers ─────────────────────────────────────────────────

describe("folder menu taxonomy", () => {
  it("is the five host-owned verb groups in a fixed order", () => {
    expect([...FOLDER_MENU_GROUPS]).toEqual(["workspace", "directory", "create", "open", "maintenance"]);
  });
});

describe("isValidFolderMenuContribution (test-plan #E15, #E16)", () => {
  it("accepts a fully-formed contribution", () => {
    expect(isValidFolderMenuContribution(contribution())).toBe(true);
  });

  for (const field of ["id", "group", "label", "icon", "onSelect"] as const) {
    it(`rejects a contribution missing ${field}`, () => {
      const c = contribution() as unknown as Record<string, unknown>;
      delete c[field];
      expect(isValidFolderMenuContribution(c)).toBe(false);
    });
  }

  it("rejects a group outside the taxonomy (version mismatch, not ungrouped)", () => {
    expect(isValidFolderMenuContribution(contribution({ group: "kb" as never }))).toBe(false);
  });

  it("accepts the optional fields when well-typed, and omitted", () => {
    expect(isValidFolderMenuContribution(contribution({ badge: "3 stale", disabled: true }))).toBe(true);
    expect(isValidFolderMenuContribution(contribution({ badge: undefined, disabled: undefined }))).toBe(true);
  });

  // A non-string badge reaches React as a child and throws while the menu is
  // opening; a truthy non-boolean `disabled` silently swallows every activation.
  it("rejects a non-string badge", () => {
    expect(isValidFolderMenuContribution(contribution({ badge: {} as never }))).toBe(false);
    expect(isValidFolderMenuContribution(contribution({ badge: 3 as never }))).toBe(false);
  });

  it("rejects a non-boolean disabled", () => {
    expect(isValidFolderMenuContribution(contribution({ disabled: "false" as never }))).toBe(false);
    expect(isValidFolderMenuContribution(contribution({ disabled: 1 as never }))).toBe(false);
  });
});

describe("selectFolderMenuItems ordering (test-plan #E5, #E6, #F5)", () => {
  const a = { pluginId: "automation-plugin", ...contribution({ id: "new-automation" }) };
  const g = { pluginId: "goal-plugin", ...contribution({ id: "new-goal" }) };

  it("orders by pluginId then contribution id, independent of registration order", () => {
    const forward = selectFolderMenuItems([a, g]).map((i) => i.id);
    const reverse = selectFolderMenuItems([g, a]).map((i) => i.id);
    expect(forward).toEqual(["new-automation", "new-goal"]);
    expect(reverse).toEqual(forward);
  });

  it("F5: two plugins colliding on one id resolve by pluginId, identically in both orders", () => {
    const zed = { pluginId: "zed-plugin", ...contribution({ id: "dup", label: "Zed" }) };
    const abe = { pluginId: "abe-plugin", ...contribution({ id: "dup", label: "Abe" }) };
    expect(selectFolderMenuItems([zed, abe]).map((i) => i.pluginId)).toEqual(["abe-plugin"]);
    expect(selectFolderMenuItems([abe, zed]).map((i) => i.pluginId)).toEqual(["abe-plugin"]);
  });
});

// ── Store-level lifecycle ───────────────────────────────────────────────────

describe("store registration (test-plan #E15, #E16, #F1)", () => {
  it("a malformed contribution registers nothing and leaves siblings alone", () => {
    const store = createFolderMenuStore();
    store.registerItem(SCOPE, "p", contribution({ id: "good" }));
    store.registerItem(SCOPE, "p", contribution({ id: undefined as never }));
    store.registerItem(SCOPE, "p", contribution({ id: "bad-group", group: "nope" as never }));
    store.registerItem(SCOPE, "p", contribution({ id: "bad-badge", badge: {} as never }));
    store.registerItem(SCOPE, "p", contribution({ id: "bad-disabled", disabled: "yes" as never }));
    expect(store.getItems(SCOPE).map((i) => i.id)).toEqual(["good"]);
  });

  it("F1: re-registering the same (plugin, id) replaces the earlier callback", () => {
    const store = createFolderMenuStore();
    const first = vi.fn();
    const second = vi.fn();
    store.registerItem(SCOPE, "p", contribution({ onSelect: first }));
    store.registerItem(SCOPE, "p", contribution({ onSelect: second }));
    const items = store.getItems(SCOPE);
    expect(items).toHaveLength(1);
    items[0]!.onSelect();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a superseded registration's dispose does not evict the live one", () => {
    const store = createFolderMenuStore();
    const dispose1 = store.registerItem(SCOPE, "p", contribution({ label: "first" }));
    store.registerItem(SCOPE, "p", contribution({ label: "second" }));
    dispose1();
    expect(store.getItems(SCOPE).map((i) => i.label)).toEqual(["second"]);
  });

  it("strips non-declarative fields \u2014 a smuggled `node`/`pressed` never reaches the host", () => {
    const store = createFolderMenuStore();
    store.registerItem(SCOPE, "p", {
      ...contribution(),
      node: "<smuggled markup>",
      pressed: true,
    } as unknown as FolderMenuContribution);
    const entry = store.getItems(SCOPE)[0] as unknown as Record<string, unknown>;
    expect(entry.node).toBeUndefined();
    expect(entry.pressed).toBeUndefined();
    expect(Object.keys(entry).sort()).toEqual(
      ["badge", "disabled", "group", "icon", "id", "label", "onSelect", "pluginId"],
    );
  });

  it("returns a referentially stable snapshot until the scope changes", () => {
    const store = createFolderMenuStore();
    const before = store.getItems(SCOPE);
    expect(store.getItems(SCOPE)).toBe(before);
    store.registerItem(SCOPE, "p", contribution());
    expect(store.getItems(SCOPE)).not.toBe(before);
  });

  it("scopes are independent", () => {
    const store = createFolderMenuStore();
    store.registerItem(SCOPE, "p", contribution());
    expect(store.getItems("/repo/other")).toEqual([]);
  });
});

describe("refreshers (test-plan #E20, #E21)", () => {
  it("E20: a refresher registration contributes no menu item", () => {
    const store = createFolderMenuStore();
    store.registerRefresher(SCOPE, () => {});
    expect(store.getItems(SCOPE)).toEqual([]);
  });

  it("E21: runRefreshers fans out to every refresher registered for the scope", () => {
    const store = createFolderMenuStore();
    const automations = vi.fn();
    const goals = vi.fn();
    store.registerRefresher(SCOPE, automations);
    store.registerRefresher(SCOPE, goals);
    store.runRefreshers(SCOPE);
    expect(automations).toHaveBeenCalledTimes(1);
    expect(goals).toHaveBeenCalledTimes(1);
  });

  it("a throwing refresher does not stop its siblings", () => {
    const store = createFolderMenuStore();
    const after = vi.fn();
    store.registerRefresher(SCOPE, () => {
      throw new Error("boom");
    });
    store.registerRefresher(SCOPE, after);
    expect(() => store.runRefreshers(SCOPE)).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("disposing a refresher removes it from the fan-out", () => {
    const store = createFolderMenuStore();
    const fn = vi.fn();
    store.registerRefresher(SCOPE, fn)();
    store.runRefreshers(SCOPE);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── React bridge ────────────────────────────────────────────────────────────

describe("useFolderMenuItem bridge (test-plan #F1, #F2, #F4)", () => {
  it("a registered section's item reaches a sibling menu", () => {
    const store = createFolderMenuStore();
    const { getByTestId } = renderTree(
      store,
      <>
        <MenuProbe />
        <Section pluginId="goal-plugin" scope={SCOPE} item={contribution({ id: "new-goal", label: "New goal" })} />
      </>,
    );
    expect(getByTestId("probe").textContent).toBe("goal-plugin:new-goal:New goal");
  });

  it("F2: unmounting the section removes its item from the menu", () => {
    const store = createFolderMenuStore();
    function Tree({ mounted }: { mounted: boolean }) {
      return (
        <FolderMenuProvider store={store}>
          <MenuProbe />
          {mounted && <Section pluginId="goal-plugin" scope={SCOPE} item={contribution({ id: "new-goal" })} />}
        </FolderMenuProvider>
      );
    }
    const { rerender, getByTestId } = render(<Tree mounted />);
    expect(getByTestId("probe").textContent).toContain("new-goal");
    rerender(<Tree mounted={false} />);
    expect(getByTestId("probe").textContent).toBe("");
  });

  it("F1: unmount + remount keeps the LATEST callback, not the first", () => {
    const store = createFolderMenuStore();
    const first = vi.fn();
    const second = vi.fn();
    function Tree({ onSelect, key2 }: { onSelect: () => void; key2: string }) {
      return (
        <FolderMenuProvider store={store}>
          <Section
            key={key2}
            pluginId="goal-plugin"
            scope={SCOPE}
            item={contribution({ id: "new-goal", onSelect })}
          />
        </FolderMenuProvider>
      );
    }
    const { rerender } = render(<Tree onSelect={first} key2="a" />);
    rerender(<Tree onSelect={second} key2="b" />);
    const items = store.getItems(SCOPE);
    expect(items).toHaveLength(1);
    act(() => items[0]!.onSelect());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("F4: a null scope (card placement — no folder menu) registers nothing", () => {
    const store = createFolderMenuStore();
    const { getByTestId } = renderTree(
      store,
      <>
        <MenuProbe />
        <Section pluginId="kb-plugin" scope={null} item={contribution({ id: "kb-reindex" })} />
      </>,
    );
    expect(getByTestId("probe").textContent).toBe("");
  });

  it("an already-rendered menu converges when a late section registers", () => {
    const store = createFolderMenuStore();
    function Tree({ late }: { late: boolean }) {
      return (
        <FolderMenuProvider store={store}>
          <MenuProbe />
          {late && <Section pluginId="kb-plugin" scope={SCOPE} item={contribution({ id: "kb-reindex" })} />}
        </FolderMenuProvider>
      );
    }
    const { rerender, getByTestId } = render(<Tree late={false} />);
    expect(getByTestId("probe").textContent).toBe("");
    rerender(<Tree late />);
    expect(getByTestId("probe").textContent).toContain("kb-reindex");
  });

  it("a changed label re-registers, but an unchanged render does not churn the snapshot", () => {
    const store = createFolderMenuStore();
    function Tree({ label }: { label: string }) {
      return (
        <FolderMenuProvider store={store}>
          <Section pluginId="kb-plugin" scope={SCOPE} item={contribution({ id: "kb", label })} />
        </FolderMenuProvider>
      );
    }
    const { rerender } = render(<Tree label="Reindex" />);
    const snapshot = store.getItems(SCOPE);
    rerender(<Tree label="Reindex" />);
    expect(store.getItems(SCOPE)).toBe(snapshot);
    rerender(<Tree label="Retry" />);
    expect(store.getItems(SCOPE).map((i) => i.label)).toEqual(["Retry"]);
  });

  it("invokes the LATEST onSelect without re-registering when only the closure changed", () => {
    const store = createFolderMenuStore();
    const first = vi.fn();
    const second = vi.fn();
    function Tree({ onSelect }: { onSelect: () => void }) {
      return (
        <FolderMenuProvider store={store}>
          <Section pluginId="kb-plugin" scope={SCOPE} item={contribution({ id: "kb", onSelect })} />
        </FolderMenuProvider>
      );
    }
    const { rerender } = render(<Tree onSelect={first} />);
    const snapshot = store.getItems(SCOPE);
    rerender(<Tree onSelect={second} />);
    // No rendered field changed, so the registration is NOT churned …
    expect(store.getItems(SCOPE)).toBe(snapshot);
    // … yet the item still runs the current closure, not the stale one.
    act(() => store.getItems(SCOPE)[0]!.onSelect());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stamps the plugin id from the plugin context, ignoring any payload-supplied one", () => {
    const store = createFolderMenuStore();
    renderTree(
      store,
      <Section
        pluginId="goal-plugin"
        scope={SCOPE}
        item={{ ...contribution(), pluginId: "automation-plugin" } as FolderMenuContribution}
      />,
    );
    expect(store.getItems(SCOPE).map((i) => i.pluginId)).toEqual(["goal-plugin"]);
  });
});

describe("useFolderMenuRefresher bridge", () => {
  it("registers for the scope and deregisters on unmount", () => {
    const store = createFolderMenuStore();
    const fn = vi.fn();
    function Refresher() {
      useFolderMenuRefresher(SCOPE, fn);
      return null;
    }
    function Tree({ mounted }: { mounted: boolean }) {
      return <FolderMenuProvider store={store}>{mounted && <Refresher />}</FolderMenuProvider>;
    }
    const { rerender } = render(<Tree mounted />);
    store.runRefreshers(SCOPE);
    expect(fn).toHaveBeenCalledTimes(1);
    rerender(<Tree mounted={false} />);
    store.runRefreshers(SCOPE);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("always invokes the latest callback without re-registering", () => {
    const store = createFolderMenuStore();
    const first = vi.fn();
    const second = vi.fn();
    function Refresher({ fn }: { fn: () => void }) {
      useFolderMenuRefresher(SCOPE, fn);
      return null;
    }
    function Tree({ fn }: { fn: () => void }) {
      return (
        <FolderMenuProvider store={store}>
          <Refresher fn={fn} />
        </FolderMenuProvider>
      );
    }
    const { rerender } = render(<Tree fn={first} />);
    rerender(<Tree fn={second} />);
    store.runRefreshers(SCOPE);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
