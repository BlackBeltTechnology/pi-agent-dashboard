import { mdiFileDocumentOutline, mdiViewSplitHorizontal } from "@mdi/js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSplitState } from "../../lib/layout/split-state.js";
import { LayoutModeSwitch } from "../split/LayoutModeSwitch.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());

function renderWithProvider(sessionId = "s1") {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SplitWorkspaceProvider sessionId={sessionId} cwd="/proj" orientation="h">
      {children}
    </SplitWorkspaceProvider>
  );
  return render(<LayoutModeSwitch />, { wrapper });
}

describe("LayoutModeSwitch", () => {
  it("renders nothing outside a provider", () => {
    const { container } = render(<LayoutModeSwitch />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a radiogroup with three radio segments", () => {
    renderWithProvider();
    const group = screen.getByTestId("layout-mode-switch");
    expect(group.getAttribute("role")).toBe("radiogroup");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByTestId("layout-mode-closed")).toBeTruthy();
    expect(screen.getByTestId("layout-mode-split")).toBeTruthy();
    expect(screen.getByTestId("layout-mode-full")).toBeTruthy();
  });

  it("reflects the active mode via aria-checked (closed = Chat checked by default)", () => {
    renderWithProvider("sReflect");
    expect(screen.getByTestId("layout-mode-closed").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("layout-mode-split").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("layout-mode-full").getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a segment sets and persists the mode", () => {
    renderWithProvider("sClick");
    fireEvent.click(screen.getByTestId("layout-mode-split"));
    expect(loadSplitState("sClick").mode).toBe("split");
    expect(screen.getByTestId("layout-mode-split").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("layout-mode-full"));
    expect(loadSplitState("sClick").mode).toBe("full");
  });

  it("A1 roving tabindex: only the active radio is tabbable", () => {
    renderWithProvider("sRove");
    // Default closed → Chat active.
    expect(screen.getByTestId("layout-mode-closed").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("layout-mode-split").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByTestId("layout-mode-full").getAttribute("tabindex")).toBe("-1");
  });

  it("A1 Arrow keys move selection (roving), and set the mode", () => {
    renderWithProvider("sArrow");
    const chat = screen.getByTestId("layout-mode-closed");
    chat.focus();
    fireEvent.keyDown(chat, { key: "ArrowRight" });
    expect(loadSplitState("sArrow").mode).toBe("split");
    const split = screen.getByTestId("layout-mode-split");
    fireEvent.keyDown(split, { key: "ArrowRight" });
    expect(loadSplitState("sArrow").mode).toBe("full");
    // Wrap-around at the end.
    const full = screen.getByTestId("layout-mode-full");
    fireEvent.keyDown(full, { key: "ArrowRight" });
    expect(loadSplitState("sArrow").mode).toBe("closed");
  });

  it("A1 Home/End jump to first/last segment", () => {
    renderWithProvider("sHomeEnd");
    const chat = screen.getByTestId("layout-mode-closed");
    chat.focus();
    fireEvent.keyDown(chat, { key: "End" });
    expect(loadSplitState("sHomeEnd").mode).toBe("full");
    const full = screen.getByTestId("layout-mode-full");
    fireEvent.keyDown(full, { key: "Home" });
    expect(loadSplitState("sHomeEnd").mode).toBe("closed");
  });

  it("A1 Enter/Space select the focused segment", () => {
    renderWithProvider("sSelect");
    const split = screen.getByTestId("layout-mode-split");
    split.focus();
    fireEvent.keyDown(split, { key: "Enter" });
    expect(loadSplitState("sSelect").mode).toBe("split");
    const full = screen.getByTestId("layout-mode-full");
    full.focus();
    fireEvent.keyDown(full, { key: " " });
    expect(loadSplitState("sSelect").mode).toBe("full");
  });
});

describe("LayoutModeSwitch menu variant (mobile, E15)", () => {
  function renderMenu(sessionId: string) {
    return render(
      <SplitWorkspaceProvider sessionId={sessionId} cwd="/proj" orientation="v">
        <LayoutModeSwitch variant="menu" />
      </SplitWorkspaceProvider>,
    );
  }

  it("E15 opens a menu of three menuitemradio items; Arrow keys + Enter choose Editor", () => {
    renderMenu("sMenu");
    const trigger = screen.getByTestId("layout-mode-switch");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(3);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("layout-mode-split").textContent).toContain("Chat above, editor below");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "Enter" });
    expect(loadSplitState("sMenu").mode).toBe("full");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    // The trigger now shows the Editor glyph.
    expect(trigger.querySelector("svg path")?.getAttribute("d")).toBe(mdiFileDocumentOutline);
  });

  it("Escape closes without changing the mode and refocuses the trigger", () => {
    renderMenu("sMenuEsc");
    const trigger = screen.getByTestId("layout-mode-switch");
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(loadSplitState("sMenuEsc").mode).toBe("closed");
    expect(document.activeElement).toBe(trigger);
  });

  it("the Split trigger shows the stacked (horizontal-divider) glyph", () => {
    renderMenu("sMenuSplit");
    fireEvent.click(screen.getByTestId("layout-mode-switch"));
    fireEvent.click(screen.getByTestId("layout-mode-split"));
    expect(screen.getByTestId("layout-mode-switch").querySelector("svg path")?.getAttribute("d")).toBe(mdiViewSplitHorizontal);
  });
});
