import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { StatusPill } from "../StatusPill.js";

afterEach(() => cleanup());

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

  // Post static-conversion (change: shrink-client-index-chunk): mdi[key] is a
  // synchronous lookup, so the icon path renders immediately with no useEffect.
  it("renders the icon <path> synchronously for a valid mdi key (test-plan #S3)", () => {
    const { container } = render(
      <StatusPill state="running" text="Working" icon="mdiRefresh" />,
    );
    const p = container.querySelector("svg path");
    expect(p).toBeTruthy();
    expect(p?.getAttribute("d") ?? "").not.toBe("");
  });

  it("renders no icon and does not throw for an unknown mdi key (test-plan #S3)", () => {
    const { container } = render(
      <StatusPill state="error" text="Failed" icon="mdiNotAReal" />,
    );
    expect(container.querySelector("svg path")).toBeNull();
    expect(container.querySelector("[data-status-pill]")?.textContent).toContain("Failed");
  });
});
