import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";
import { formatNewChangePrompt, NewChangeDialog } from "../openspec/NewChangeDialog.js";

afterEach(() => cleanup());

// NewChangeDialog now consumes the run-config context; wrap every render.
const render = (ui: React.ReactElement) =>
  rtlRender(<RunConfigHarness value={makeRunConfig()}>{ui}</RunConfigHarness>);

describe("formatNewChangePrompt", () => {
  it("formats with name and description", () => {
    expect(formatNewChangePrompt("add-auth", "Add OAuth support")).toBe("/skill:openspec-new-change add-auth\nAdd OAuth support");
  });

  it("formats with name only", () => {
    expect(formatNewChangePrompt("add-auth", "")).toBe("/skill:openspec-new-change add-auth");
  });

  it("formats with description only", () => {
    expect(formatNewChangePrompt("", "Add OAuth support")).toBe("/skill:openspec-new-change\nAdd OAuth support");
  });

  it("formats with both empty", () => {
    expect(formatNewChangePrompt("", "")).toBe("/skill:openspec-new-change");
  });

  it("trims whitespace", () => {
    expect(formatNewChangePrompt("  add-auth  ", "  desc  ")).toBe("/skill:openspec-new-change add-auth\ndesc");
  });
});

describe("NewChangeDialog", () => {
  it("renders name input and description textarea", () => {
    render(<NewChangeDialog onSend={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("new-change-name")).toBeTruthy();
    expect(screen.getByTestId("new-change-description")).toBeTruthy();
  });

  it("sends prompt with name and description", () => {
    const onSend = vi.fn();
    render(<NewChangeDialog onSend={onSend} onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId("new-change-name"), { target: { value: "add-auth" } });
    fireEvent.change(screen.getByTestId("new-change-description"), { target: { value: "Add OAuth" } });
    fireEvent.click(screen.getByTestId("new-change-send"));

    expect(onSend).toHaveBeenCalledWith("/skill:openspec-new-change add-auth\nAdd OAuth");
  });

  it("sends prompt with both empty", () => {
    const onSend = vi.fn();
    render(<NewChangeDialog onSend={onSend} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("new-change-send"));
    expect(onSend).toHaveBeenCalledWith("/skill:openspec-new-change");
  });

  it("calls onClose when Cancel clicked", () => {
    const onClose = vi.fn();
    render(<NewChangeDialog onSend={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("new-change-cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<NewChangeDialog onSend={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("new-change-name"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends on Cmd+Enter", () => {
    const onSend = vi.fn();
    render(<NewChangeDialog onSend={onSend} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("new-change-name"), { target: { value: "test" } });
    fireEvent.keyDown(screen.getByTestId("new-change-name"), { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("/skill:openspec-new-change test");
  });
});
