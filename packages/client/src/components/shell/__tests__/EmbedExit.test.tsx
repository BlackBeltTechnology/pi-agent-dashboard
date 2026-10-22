/** Test-plan #E12 — leaving embed mode keeps the other parameters. See change: add-session-ui-deep-links-for-agents. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { buildEmbedExitTarget, EmbedExit, EmbedHome } from "../EmbedExit.js";

afterEach(cleanup);

type Nav = (to: string, opts?: { replace?: boolean }) => void;

function at(location: string, ui: (navigate: Nav) => React.ReactElement) {
  const navigate = vi.fn<Nav>();
  const { hook, searchHook } = memoryLocation({ path: location.split("?")[0], searchPath: location.split("?")[1] ?? "" });
  render(
    <Router hook={hook} searchHook={searchHook}>
      {ui(navigate)}
    </Router>,
  );
  return navigate;
}

describe("EmbedExit", () => {
  it.each([
    ["/session/x?archived=1", "/session/x?archived=1&embed=0"],
    ["/session/x?embed=1&focus=terminal", "/session/x?focus=terminal&embed=0"],
    ["/", "/?embed=0"],
  ])("E12: %s → %s with replace", (from, to) => {
    const navigate = at(from, (n) => <EmbedExit navigate={n} />);
    fireEvent.click(screen.getByTestId("embed-exit"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(to, { replace: true });
  });

  it("buildEmbedExitTarget is pure", () => {
    expect(buildEmbedExitTarget("/session/x", "?embed=1")).toBe("/session/x?embed=0");
    expect(buildEmbedExitTarget("/a b", "q=1")).toBe("/a b?q=1&embed=0");
  });

  it("EmbedHome shows the no-session message with the exit control", () => {
    at("/", (n) => <EmbedHome navigate={n} />);
    expect(screen.getByTestId("embed-home")).toBeTruthy();
    expect(screen.getByTestId("embed-exit")).toBeTruthy();
    expect(screen.queryByTestId("session-list")).toBeNull();
  });
});
