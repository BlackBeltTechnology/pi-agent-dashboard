import { mdiCheck } from "@mdi/js";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { __resetMdiIconSetForTests, loadMdiIconSet } from "../mdi-by-key.js";
import { StatusPill } from "../StatusPill.js";

afterEach(() => {
  cleanup();
  __resetMdiIconSetForTests();
});

describe("StatusPill", () => {
  it("renders the text", () => {
    const { getByText } = render(<StatusPill state="running" text="Working" />);
    expect(getByText("Working")).toBeDefined();
  });

  it("sets data-status-pill attribute to state", () => {
    const { container } = render(<StatusPill state="error" text="Failed" />);
    expect(container.firstChild).toHaveProperty("dataset");
    const el = container.querySelector("[data-status-pill]");
    expect(el?.getAttribute("data-status-pill")).toBe("error");
  });

  it("each state renders with state-specific styling", () => {
    const states: Array<"running" | "success" | "error" | "info" | "warn" | "muted"> = [
      "running",
      "success",
      "error",
      "info",
      "warn",
      "muted",
    ];
    for (const state of states) {
      const { container, unmount } = render(<StatusPill state={state} text={state} />);
      const el = container.querySelector(`[data-status-pill="${state}"]`);
      expect(el).toBeTruthy();
      unmount();
    }
  });

  it("tooltip is set from `tooltip` prop", () => {
    const { container } = render(
      <StatusPill state="running" text="X" tooltip="Currently running" />,
    );
    expect(container.firstChild?.parentElement?.getAttribute("title") ?? container.querySelector("[title]")?.getAttribute("title")).toBe("Currently running");
  });

  // Lazy icon set (change: harden-ios-safari-memory-and-ws-diagnostics):
  // the icon renders nothing until the full MDI set loads, then its path.
  it("renders no icon and no placeholder before load, then the icon path (test-plan #E5)", async () => {
    const { container } = render(
      <StatusPill state="running" text="Working" icon="mdiCheck" />,
    );
    expect(container.querySelector("svg")).toBeNull();
    // No placeholder slot: only the label <span> is rendered.
    expect(container.querySelector('[data-status-pill]')?.children).toHaveLength(1);
    await waitFor(() => {
      const p = container.querySelector("svg path");
      expect(p).toBeTruthy();
      expect(p?.getAttribute("d")).toBe(mdiCheck);
    });
  });

  it("renders no icon and does not throw for an unknown mdi key (test-plan #S3)", async () => {
    const { container } = render(
      <StatusPill state="error" text="Failed" icon="mdiNotAReal" />,
    );
    expect(container.querySelector("svg path")).toBeNull();
    await act(async () => {
      await loadMdiIconSet();
    });
    expect(container.querySelector("svg path")).toBeNull();
    expect(container.querySelector("[data-status-pill]")?.textContent).toContain("Failed");
  });
});
