import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { SessionActivityBar, MAX_VISIBLE, STOP_TOOLTIP } from "../SessionActivityBar.js";
import type { InflightBashTool } from "../../hooks/useInflightBashTools.js";

function mk(id: string, command = `cmd-${id}`, startedAt = 0): InflightBashTool {
  return { toolCallId: id, command, startedAt };
}

afterEach(() => cleanup());

describe("SessionActivityBar (redesign-process-list-activity-bar)", () => {
  const onAbort = vi.fn();
  const NOW = 100_000;

  it("renders null when no tools in flight", () => {
    const { container } = render(<SessionActivityBar tools={[]} onAbort={onAbort} now={NOW} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row for one tool with command + elapsed + stop button", () => {
    const tool = mk("tc-1", "npm test", NOW - 12_000);
    const { container, getByTestId, getByTitle } = render(
      <SessionActivityBar tools={[tool]} onAbort={onAbort} now={NOW} />,
    );
    expect(container.querySelectorAll('[data-testid="session-activity-row"]').length).toBe(1);
    expect(container.textContent).toContain("npm test");
    expect(container.textContent).toContain("12s");
    expect(getByTestId("session-activity-stop")).toBeTruthy();
    expect(getByTitle(STOP_TOOLTIP)).toBeTruthy();
  });

  it("renders up to MAX_VISIBLE rows without overflow chip", () => {
    const tools = Array.from({ length: MAX_VISIBLE }, (_, i) => mk(`tc-${i}`, `cmd-${i}`, NOW - i * 1000));
    const { container, queryByTestId } = render(
      <SessionActivityBar tools={tools} onAbort={onAbort} now={NOW} />,
    );
    expect(container.querySelectorAll('[data-testid="session-activity-row"]').length).toBe(MAX_VISIBLE);
    expect(queryByTestId("session-activity-overflow")).toBeNull();
  });

  it("renders MAX_VISIBLE rows + overflow chip at N+1", () => {
    const tools = Array.from({ length: MAX_VISIBLE + 1 }, (_, i) => mk(`tc-${i}`, `cmd-${i}`, NOW - i * 1000));
    const { container, getByTestId } = render(
      <SessionActivityBar tools={tools} onAbort={onAbort} now={NOW} />,
    );
    expect(container.querySelectorAll('[data-testid="session-activity-row"]').length).toBe(MAX_VISIBLE);
    expect(getByTestId("session-activity-overflow").textContent).toContain("+1 more");
  });

  it("overflow chip count reflects all hidden rows", () => {
    const tools = Array.from({ length: MAX_VISIBLE + 3 }, (_, i) => mk(`tc-${i}`, `cmd-${i}`, NOW - i * 1000));
    const { getByTestId } = render(
      <SessionActivityBar tools={tools} onAbort={onAbort} now={NOW} />,
    );
    expect(getByTestId("session-activity-overflow").textContent).toContain(`+${3} more`);
  });

  it("stop click invokes onAbort with the row's toolCallId", () => {
    onAbort.mockClear();
    const tools = [mk("tc-a"), mk("tc-b")];
    const { container } = render(
      <SessionActivityBar tools={tools} onAbort={onAbort} now={NOW} />,
    );
    const stops = container.querySelectorAll('[data-testid="session-activity-stop"]');
    expect(stops.length).toBe(2);
    fireEvent.click(stops[1]);
    expect(onAbort).toHaveBeenCalledWith("tc-b");
    fireEvent.click(stops[0]);
    expect(onAbort).toHaveBeenCalledWith("tc-a");
  });

  it("container has role=status and aria-live=polite (a11y)", () => {
    const { getByTestId } = render(
      <SessionActivityBar tools={[mk("tc-1")]} onAbort={onAbort} now={NOW} />,
    );
    const bar = getByTestId("session-activity-bar");
    expect(bar.getAttribute("role")).toBe("status");
    expect(bar.getAttribute("aria-live")).toBe("polite");
  });

  it("formats elapsed under one minute as `Ns`", () => {
    const { container } = render(
      <SessionActivityBar tools={[mk("tc-1", "x", NOW - 47_000)]} onAbort={onAbort} now={NOW} />,
    );
    expect(container.textContent).toContain("47s");
  });

  it("formats elapsed over one minute as `Nm SSs`", () => {
    const { container } = render(
      <SessionActivityBar tools={[mk("tc-1", "x", NOW - (2 * 60 + 14) * 1000)]} onAbort={onAbort} now={NOW} />,
    );
    expect(container.textContent).toContain("2m 14s");
  });
});
