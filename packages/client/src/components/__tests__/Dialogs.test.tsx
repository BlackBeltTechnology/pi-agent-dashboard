import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";
import { ExploreDialog } from "../openspec/ExploreDialog.js";

afterEach(() => cleanup());

// ExploreDialog now consumes the run-config context; wrap every render.
const renderExplore = (props: React.ComponentProps<typeof ExploreDialog>) =>
  render(
    <RunConfigHarness value={makeRunConfig()}>
      <ExploreDialog {...props} />
    </RunConfigHarness>,
  );

describe("Confirm", () => {
  it("renders message and buttons", () => {
    render(
      <Confirm
        open
        title="Archive change?"
        message='Archive "feat"?'
        onConfirm={() => {}}
        onClose={() => {}}
        testId="confirm"
      />,
    );
    expect(screen.getByText('Archive "feat"?')).toBeTruthy();
    expect(screen.getByTestId("confirm-cancel")).toBeTruthy();
    expect(screen.getByTestId("confirm-action")).toBeTruthy();
  });

  it("calls onConfirm when confirm clicked", () => {
    const onConfirm = vi.fn();
    render(
      <Confirm
        open
        title="t"
        message="Sure?"
        onConfirm={onConfirm}
        onClose={() => {}}
        testId="confirm"
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-action"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onClose when cancel clicked", () => {
    const onClose = vi.fn();
    render(
      <Confirm
        open
        title="t"
        message="Sure?"
        onConfirm={() => {}}
        onClose={onClose}
        testId="confirm"
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses custom confirmLabel", () => {
    render(
      <Confirm
        open
        title="t"
        message="Sure?"
        confirmLabel="Delete"
        onConfirm={() => {}}
        onClose={() => {}}
        testId="confirm"
      />,
    );
    expect(screen.getByTestId("confirm-action").textContent).toBe("Delete");
  });
});

describe("ExploreDialog", () => {
  it("renders the static title and a separate name chip", () => {
    renderExplore({ changeName: "feat-a", onSend: () => {}, onClose: () => {} });
    expect(screen.getByRole("heading", { name: "Explore" })).toBeTruthy();
    expect(screen.getByTestId("explore-name-chip").textContent).toBe("feat-a");
  });

  it("calls onSend with text when Send clicked (controls unchanged)", () => {
    const onSend = vi.fn();
    renderExplore({ changeName: "feat-a", onSend, onClose: () => {} });
    const textarea = screen.getByTestId("explore-textarea");
    fireEvent.change(textarea, { target: { value: "my question" } });
    fireEvent.click(screen.getByTestId("explore-send"));
    expect(onSend).toHaveBeenCalledWith("my question", undefined);
  });

  it("does not send when text is empty", () => {
    const onSend = vi.fn();
    renderExplore({ changeName: "feat-a", onSend, onClose: () => {} });
    fireEvent.click(screen.getByTestId("explore-send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onClose when cancel clicked", () => {
    const onClose = vi.fn();
    renderExplore({ changeName: "feat-a", onSend: () => {}, onClose });
    fireEvent.click(screen.getByTestId("explore-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
