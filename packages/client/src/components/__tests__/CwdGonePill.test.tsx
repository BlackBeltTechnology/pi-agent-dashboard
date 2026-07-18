/**
 * Tests for CwdGonePill. See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CwdGonePill } from "../folder/CwdGonePill.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

function s(over: Partial<DashboardSession> = {}): DashboardSession {
  return { id: "x", cwd: "/x", source: "dashboard", status: "ended", startedAt: 1, ...over } as DashboardSession;
}

describe("CwdGonePill", () => {
  it("renders when cwdMissing is true", () => {
    render(<CwdGonePill session={s({ cwdMissing: true })} />);
    expect(screen.getByTestId("cwd-gone-pill")).toBeTruthy();
  });
  it("does not render when cwdMissing is undefined", () => {
    render(<CwdGonePill session={s()} />);
    expect(screen.queryByTestId("cwd-gone-pill")).toBeNull();
  });
  it("does not render when cwdMissing is false", () => {
    render(<CwdGonePill session={s({ cwdMissing: false })} />);
    expect(screen.queryByTestId("cwd-gone-pill")).toBeNull();
  });
  it("includes tooltip text", () => {
    render(<CwdGonePill session={s({ cwdMissing: true })} />);
    expect(screen.getByTestId("cwd-gone-pill").getAttribute("title"))
      .toContain("no longer exists");
  });
});
