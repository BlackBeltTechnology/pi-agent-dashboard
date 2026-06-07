/**
 * Tests for the Phase-1 Extension UI System client surface:
 *
 *   - `GenericExtensionDialog` renders `table` / `grid` / `form` views.
 *   - On mount of `table`/`grid`, the dialog dispatches
 *     `ui_management { action: "list", event: view.dataEvent }`.
 *   - On `ui_data_list` arrival (parent re-renders with new `rows`), the
 *     table re-renders.
 *   - `UiAction.confirm` mounts ConfirmDialog; cancel does NOT dispatch;
 *     confirm dispatches.
 *   - `resolveMdiIcon` returns null for unknown keys (no error).
 *
 * The slash-command interception is exercised at the App.tsx integration
 * layer in `App.tsx`'s `wrappedHandleSend`. We unit-test the same logic in
 * isolation here (a small pure function mirroring the production behavior).
 *
 * See change: add-extension-ui-modal.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { GenericExtensionDialog } from "../components/extension-ui/GenericExtensionDialog.js";
import { resolveMdiIcon } from "../lib/mdi-icon-lookup.js";
import type { ExtensionUiModule } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const baseTableModule: ExtensionUiModule = {
  kind: "management-modal",
  id: "judo-status",
  command: "/judo:status",
  title: "Judo Status",
  description: "Pending status rows",
  view: {
    kind: "table",
    dataEvent: "judo:status-rows",
    rowKey: "id",
    fields: [
      { key: "id", label: "ID", kind: "text", width: 80 },
      { key: "name", label: "Name", kind: "text" },
    ],
    rowActions: [
      {
        id: "delete",
        label: "Delete",
        variant: "danger",
        event: "judo:delete-row",
        confirm: "Delete this entry?",
      },
    ],
    actions: [
      { id: "refresh", label: "Refresh", event: "judo:refresh", variant: "secondary" },
    ],
    emptyState: "Nothing to see here.",
  },
};

describe("GenericExtensionDialog — table view", () => {
  it("dispatches ui_management {action: 'list'} on mount", () => {
    const onDispatch = vi.fn();
    render(
      <GenericExtensionDialog
        module={baseTableModule}
        rows={[]}
        onDispatch={onDispatch}
        onClose={() => {}}
      />,
    );

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith({ action: "list", event: "judo:status-rows" });
  });

  it("renders the empty state when rows is empty", () => {
    const { getByTestId, queryByTestId } = render(
      <GenericExtensionDialog
        module={baseTableModule}
        rows={[]}
        onDispatch={vi.fn()}
        onClose={() => {}}
      />,
    );

    expect(getByTestId("extension-ui-empty").textContent).toContain("Nothing to see here.");
    expect(queryByTestId("extension-ui-table")).toBeNull();
  });

  it("re-renders rows when parent passes new data (simulates ui_data_list arrival)", () => {
    const onDispatch = vi.fn();
    function Harness() {
      const [rows, setRows] = useState<unknown[]>([]);
      return (
        <>
          <button data-testid="harness-load" onClick={() => setRows([{ id: 1, name: "alpha" }, { id: 2, name: "beta" }])}>
            load
          </button>
          <GenericExtensionDialog
            module={baseTableModule}
            rows={rows}
            onDispatch={onDispatch}
            onClose={() => {}}
          />
        </>
      );
    }
    const { getByTestId, queryByTestId } = render(<Harness />);
    expect(queryByTestId("extension-ui-table")).toBeNull();

    act(() => { fireEvent.click(getByTestId("harness-load")); });

    const table = getByTestId("extension-ui-table");
    expect(table.textContent).toContain("alpha");
    expect(table.textContent).toContain("beta");
  });

  it("UiAction.confirm gates dispatch through ConfirmDialog", () => {
    const onDispatch = vi.fn();
    const { getByTestId, getAllByTestId } = render(
      <GenericExtensionDialog
        module={baseTableModule}
        rows={[{ id: 7, name: "row-seven" }]}
        onDispatch={onDispatch}
        onClose={() => {}}
      />,
    );
    onDispatch.mockClear(); // drop the mount-time list call

    // Click the row's Delete action.
    const deleteButtons = getAllByTestId("extension-ui-action-delete");
    expect(deleteButtons.length).toBeGreaterThan(0);
    act(() => { fireEvent.click(deleteButtons[0]!); });

    // ConfirmDialog mounted; no dispatch yet.
    expect(getByTestId("confirm-dialog")).toBeTruthy();
    expect(onDispatch).not.toHaveBeenCalled();

    // Cancel path: dialog closes, no dispatch.
    act(() => { fireEvent.click(getByTestId("confirm-dialog-cancel")); });
    expect(onDispatch).not.toHaveBeenCalled();

    // Click again, then confirm.
    act(() => { fireEvent.click(getAllByTestId("extension-ui-action-delete")[0]!); });
    act(() => { fireEvent.click(getByTestId("confirm-dialog-action")); });

    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "delete",
        event: "judo:delete-row",
      }),
    );
    // Row payload merged into params.
    expect(onDispatch.mock.calls[0]?.[0]?.params).toMatchObject({ row: { id: 7, name: "row-seven" } });
  });

  it("non-confirming action dispatches immediately", () => {
    const onDispatch = vi.fn();
    const { getByTestId } = render(
      <GenericExtensionDialog
        module={baseTableModule}
        rows={[]}
        onDispatch={onDispatch}
        onClose={() => {}}
      />,
    );
    onDispatch.mockClear();

    act(() => { fireEvent.click(getByTestId("extension-ui-action-refresh")); });
    expect(onDispatch).toHaveBeenCalledTimes(1);
    expect(onDispatch).toHaveBeenCalledWith({ action: "refresh", event: "judo:refresh", params: undefined });
  });
});

describe("GenericExtensionDialog — grid view", () => {
  const gridModule: ExtensionUiModule = {
    ...baseTableModule,
    id: "judo-grid",
    view: {
      ...baseTableModule.view,
      kind: "grid",
    },
  };

  it("dispatches list and renders cards", () => {
    const onDispatch = vi.fn();
    const { getByTestId } = render(
      <GenericExtensionDialog
        module={gridModule}
        rows={[{ id: 1, name: "alpha" }]}
        onDispatch={onDispatch}
        onClose={() => {}}
      />,
    );

    expect(onDispatch).toHaveBeenCalledWith({ action: "list", event: "judo:status-rows" });
    const grid = getByTestId("extension-ui-grid");
    expect(grid.textContent).toContain("alpha");
  });
});

describe("GenericExtensionDialog — form view", () => {
  const formModule: ExtensionUiModule = {
    kind: "management-modal",
    id: "judo-config",
    command: "/judo:config",
    title: "Judo Config",
    view: {
      kind: "form",
      sections: [
        {
          id: "general",
          title: "General",
          fields: [
            { key: "name", label: "Name", kind: "text" },
            { key: "enabled", label: "Enabled", kind: "boolean" },
          ],
        },
      ],
      actions: [
        { id: "save", label: "Save", event: "judo:save", variant: "primary" },
      ],
    },
  };

  it("does NOT dispatch a list call on mount (no data lifecycle for form)", () => {
    const onDispatch = vi.fn();
    render(
      <GenericExtensionDialog
        module={formModule}
        rows={[]}
        onDispatch={onDispatch}
        onClose={() => {}}
      />,
    );
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it("renders sections + fields + toolbar action", () => {
    const onDispatch = vi.fn();
    const { getByTestId, getByText } = render(
      <GenericExtensionDialog
        module={formModule}
        rows={[]}
        onDispatch={onDispatch}
        onClose={() => {}}
      />,
    );
    expect(getByTestId("extension-ui-form")).toBeTruthy();
    expect(getByText("General")).toBeTruthy();
    expect(getByText("Name")).toBeTruthy();
    expect(getByText("Enabled")).toBeTruthy();

    act(() => { fireEvent.click(getByTestId("extension-ui-action-save")); });
    expect(onDispatch).toHaveBeenCalledWith({ action: "save", event: "judo:save", params: undefined });
  });
});

describe("GenericExtensionDialog — close behavior", () => {
  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <GenericExtensionDialog
        module={baseTableModule}
        rows={[]}
        onDispatch={vi.fn()}
        onClose={onClose}
      />,
    );
    act(() => { fireEvent.click(getByTestId("extension-ui-close")); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("resolveMdiIcon — fallback for unknown keys", () => {
  it("returns null for unknown / mistyped / missing keys", () => {
    expect(resolveMdiIcon(undefined)).toBeNull();
    expect(resolveMdiIcon("")).toBeNull();
    expect(resolveMdiIcon("totallyMadeUpName")).toBeNull(); // no `mdi` prefix
    expect(resolveMdiIcon("mdiTotallyMadeUpName")).toBeNull(); // not in @mdi/js
  });

  it("returns a path for a known key", () => {
    const path = resolveMdiIcon("mdiCheck");
    expect(typeof path).toBe("string");
    expect(path?.length).toBeGreaterThan(0);
  });
});

describe("Slash-command interception (pure logic)", () => {
  // Mirrors `App.tsx`'s `wrappedHandleSend` decision: exact-match against
  // `module.command`, case-sensitive, with built-in collision dropping.
  const BUILTINS = new Set(["/flows", "/flows:new", "/compact", "/reload", "/new", "/model", "/roles"]);

  function classify(input: string, modules: ExtensionUiModule[]): { kind: "module"; id: string } | { kind: "builtin-collision"; id: string } | { kind: "passthrough" } {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return { kind: "passthrough" };
    const match = modules.find((m) => m.command === trimmed && !BUILTINS.has(m.command));
    if (match) return { kind: "module", id: match.id };
    const colliding = modules.find((m) => m.command === trimmed && BUILTINS.has(m.command));
    if (colliding) return { kind: "builtin-collision", id: colliding.id };
    return { kind: "passthrough" };
  }

  it("opens the matching module on exact-match command", () => {
    const result = classify("/judo:status", [baseTableModule]);
    expect(result).toEqual({ kind: "module", id: "judo-status" });
  });

  it("does NOT match prefix or substring", () => {
    expect(classify("/judo:status arg", [baseTableModule])).toEqual({ kind: "passthrough" });
    expect(classify("/judo:stat", [baseTableModule])).toEqual({ kind: "passthrough" });
    expect(classify("/JUDO:STATUS", [baseTableModule])).toEqual({ kind: "passthrough" });
  });

  it("flags built-in collisions and falls through to the built-in handler", () => {
    const collidingModule: ExtensionUiModule = { ...baseTableModule, id: "evil-model", command: "/model" };
    const result = classify("/model", [collidingModule]);
    expect(result).toEqual({ kind: "builtin-collision", id: "evil-model" });
  });

  it("returns passthrough for unknown commands and non-slash input", () => {
    expect(classify("/unknown", [baseTableModule])).toEqual({ kind: "passthrough" });
    expect(classify("hello world", [baseTableModule])).toEqual({ kind: "passthrough" });
    expect(classify("", [baseTableModule])).toEqual({ kind: "passthrough" });
  });
});
