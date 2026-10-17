import { mdiRefresh } from "@mdi/js";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionList } from "../ActionList.js";

type Actions = React.ComponentProps<typeof ActionList>["actions"];
/** Plugin-emitted items carry `dataAction`, which the declared item type omits. */
const asActions = (items: unknown[]) => items as Actions;
import { ActionListMenuContext } from "../ActionListMenuContext.js";
import { __resetMdiIconSetForTests, loadMdiIconSet } from "../mdi-by-key.js";

const sendPluginAction = vi.hoisted(() => vi.fn());
vi.mock("@blackbelt-technology/dashboard-plugin-runtime", () => ({ sendPluginAction }));

afterEach(() => {
  sendPluginAction.mockClear();
  cleanup();
  __resetMdiIconSetForTests();
});

describe("ActionList", () => {
  it("renders nothing for empty actions", () => {
    const { container } = render(<ActionList actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each action as a button", () => {
    const { getAllByRole } = render(
      <ActionList
        actions={[
          { label: "Run A" },
          { label: "Run B" },
        ]}
      />,
    );
    const buttons = getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Run A");
    expect(buttons[1].textContent).toContain("Run B");
  });

  it("clicking calls onClick", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <ActionList actions={[{ label: "Run", onClick }]} />,
    );
    fireEvent.click(getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled buttons do not trigger onClick", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <ActionList actions={[{ label: "Run", onClick, disabled: true }]} />,
    );
    fireEvent.click(getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("tooltip is set from `tooltip` prop", () => {
    const { getByRole } = render(
      <ActionList actions={[{ label: "Run", tooltip: "Run flow X" }]} />,
    );
    expect(getByRole("button").getAttribute("title")).toBe("Run flow X");
  });

  // Lazy icon set (change: harden-ios-safari-memory-and-ws-diagnostics):
  // the icon renders nothing until the full MDI set loads, then its path.
  it("renders no icon and no placeholder before load, then the icon path (test-plan #E4)", async () => {
    const { container } = render(
      <ActionList actions={[{ label: "Refresh", icon: "mdiRefresh" }]} />,
    );
    expect(container.querySelector("svg")).toBeNull();
    // No placeholder slot: only the label <span> is rendered.
    expect(container.querySelector('button')?.children).toHaveLength(1);
    await waitFor(() => {
      const p = container.querySelector("svg path");
      expect(p).toBeTruthy();
      expect(p?.getAttribute("d")).toBe(mdiRefresh);
    });
  });

  it("renders no icon and does not throw for an unknown mdi key (test-plan #S3)", async () => {
    const { container } = render(
      <ActionList actions={[{ label: "Nope", icon: "mdiNotAReal" }]} />,
    );
    expect(container.querySelector("svg path")).toBeNull();
    await act(async () => {
      await loadMdiIconSet();
    });
    expect(container.querySelector("svg path")).toBeNull();
    expect(container.querySelector("button")?.textContent).toContain("Nope");
  });
});

// Menu context (change: add-session-actions-flyout, test-plan #F22).
describe("ActionList in menu context", () => {
  const dataAction = (action: string) => ({ pluginId: "p", sessionId: "s1", action, payload: { a: 1 } });

  it("renders menuitems, dispatches the descriptor and reports activation (#F22)", () => {
    const onActivate = vi.fn();
    const onClick = vi.fn();
    const { getAllByRole, queryAllByRole } = render(
      <ActionListMenuContext.Provider value={{ onActivate }}>
        <ActionList
          actions={asActions([
            { label: "One", dataAction: dataAction("one"), onClick },
            { label: "Two", dataAction: dataAction("two") },
          ])}
        />
      </ActionListMenuContext.Provider>,
    );
    const items = getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(queryAllByRole("button")).toHaveLength(0);
    expect(items[0].getAttribute("data-testid")).toBe("action-list-item");
    fireEvent.click(items[0]);
    expect(sendPluginAction).toHaveBeenCalledTimes(1);
    expect(sendPluginAction).toHaveBeenCalledWith("p", "s1", "one", { a: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("disabled menuitem is aria-disabled, focusable, and neither invokes nor reports activation", () => {
    const onActivate = vi.fn();
    const onClick = vi.fn();
    const { getByRole } = render(
      <ActionListMenuContext.Provider value={{ onActivate }}>
        <ActionList actions={asActions([{ label: "Nope", disabled: true, onClick, dataAction: dataAction("nope") }])} />
      </ActionListMenuContext.Provider>,
    );
    const item = getByRole("menuitem") as HTMLButtonElement;
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.disabled).toBe(false);
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
    expect(sendPluginAction).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("works with a context value lacking onActivate", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <ActionListMenuContext.Provider value={{}}>
        <ActionList actions={[{ label: "Go", onClick }]} />
      </ActionListMenuContext.Provider>,
    );
    fireEvent.click(getByRole("menuitem"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
