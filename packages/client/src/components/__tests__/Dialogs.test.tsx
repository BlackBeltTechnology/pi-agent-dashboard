import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { ExploreDialog } from "../openspec/ExploreDialog.js";

afterEach(() => cleanup());

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
  it("renders with change name", () => {
    render(<ExploreDialog changeName="feat-a" onSend={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Explore: feat-a")).toBeTruthy();
  });

  it("calls onSend with text when Send clicked", () => {
    const onSend = vi.fn();
    render(<ExploreDialog changeName="feat-a" onSend={onSend} onClose={() => {}} />);
    const textarea = screen.getByTestId("explore-textarea");
    fireEvent.change(textarea, { target: { value: "my question" } });
    fireEvent.click(screen.getByTestId("explore-send"));
    expect(onSend).toHaveBeenCalledWith("my question", undefined);
  });

  it("does not send when text is empty", () => {
    const onSend = vi.fn();
    render(<ExploreDialog changeName="feat-a" onSend={onSend} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("explore-send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onClose when cancel clicked", () => {
    const onClose = vi.fn();
    render(<ExploreDialog changeName="feat-a" onSend={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("explore-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
