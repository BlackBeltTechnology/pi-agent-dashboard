/**
 * Component tests for `ProjectInitButton`.
 *
 * Pins the `folder-action-bar` scaffold action: the button shows ONLY for a
 * truly-unconfigured directory (state ①, `{ hasHook:false, configured:false }`)
 * and routes its click to spawning an interactive project-init session.
 *
 * See change: distinguish-initialize-actions.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInitStatus } from "../../lib/git-api.js";
import { ProjectInitButton } from "../ProjectInitButton.js";

afterEach(() => { cleanup(); });

describe("ProjectInitButton", () => {
  it("renders for an unconfigured dir (hasHook:false, configured:false) and routes its click", () => {
    const onInitializeProject = vi.fn();
    render(
      <ProjectInitButton
        cwd="/bare"
        status={{ hasHook: false, configured: false }}
        onInitializeProject={onInitializeProject}
      />,
    );
    const btn = screen.getByTestId("project-init-btn");
    // Distinct scaffold identity — NOT the amber hook-run button.
    expect(btn.textContent).toContain("Set up project");
    expect(btn.className).not.toContain("amber");
    fireEvent.click(btn);
    expect(onInitializeProject).toHaveBeenCalledWith("/bare");
  });

  it("renders nothing for a configured-but-hookless dir (state ③)", () => {
    render(
      <ProjectInitButton
        cwd="/configured"
        status={{ hasHook: false, configured: true }}
        onInitializeProject={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
  });

  it("renders nothing when configured is absent (degraded / fail-open probe)", () => {
    const status = { hasHook: false } as WorktreeInitStatus;
    render(<ProjectInitButton cwd="/x" status={status} onInitializeProject={vi.fn()} />);
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
  });

  it("renders nothing when a hook exists (hasHook:true)", () => {
    render(
      <ProjectInitButton
        cwd="/repo"
        status={{ hasHook: true, needsInit: true, trusted: true }}
        onInitializeProject={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
  });

  it("renders nothing without an onInitializeProject handler", () => {
    render(<ProjectInitButton cwd="/bare" status={{ hasHook: false, configured: false }} />);
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
  });

  it("renders nothing when status is null (not yet probed)", () => {
    render(<ProjectInitButton cwd="/bare" status={null} onInitializeProject={vi.fn()} />);
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
  });
});
