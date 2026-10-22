/** Test-plan #E13 — `SessionNotFound` (design D3). See change: add-session-ui-deep-links-for-agents. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionNotFound } from "../SessionNotFound.js";

const A = "01a16086-aaaa-4aaa-8aaa-000000000001";
const B = "01a16086-bbbb-4bbb-8bbb-000000000002";

function Probe() {
  const [loc] = useLocation();
  return <span data-testid="loc">{loc}</span>;
}

function renderAt(ui: React.ReactElement) {
  const { hook } = memoryLocation({ path: "/session/x" });
  return render(
    <Router hook={hook}>
      {ui}
      <Probe />
    </Router>,
  );
}

afterEach(cleanup);

describe("SessionNotFound", () => {
  it("E13(a): shows the id in a <code> and explains where full ids come from; back goes home", () => {
    renderAt(<SessionNotFound id="nope" />);
    const root = screen.getByTestId("session-not-found");
    const code = root.querySelector("code");
    expect(code?.textContent).toBe("nope");
    expect(root.textContent).toContain("GET /api/sessions");
    expect(root.textContent).toContain("?archived=1");
    fireEvent.click(screen.getByRole("button", { name: /back to sessions/i }));
    expect(screen.getByTestId("loc").textContent).toBe("/");
  });

  it("E13(b): an ambiguous prefix lists a link per candidate", () => {
    renderAt(<SessionNotFound id="01a16086" candidates={[A, B]} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([`/session/${A}`, `/session/${B}`]);
  });

  it("E13(c): a failed lookup offers retry exactly once per click", () => {
    const onRetry = vi.fn();
    renderAt(<SessionNotFound id="x" lookupFailed onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("no retry control unless the lookup failed", () => {
    renderAt(<SessionNotFound id="x" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
