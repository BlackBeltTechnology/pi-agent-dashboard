/**
 * Tests for MissingToolInlineError — the inline chat error rendered when a
 * `!`/`!!` shell-escape finds no shell binary. Covers the deep-link click:
 * it flags the install target and navigates to Settings → Tools.
 *
 * See change: register-bash-and-tool-install-help.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/session/x", navigate] as const,
}));

const requestToolInstall = vi.fn();
vi.mock("../../lib/package/tool-install-deeplink.js", () => ({
  requestToolInstall: (...a: unknown[]) => requestToolInstall(...a),
}));

import { MissingToolInlineError } from "../chat/MissingToolInlineError.js";

describe("MissingToolInlineError", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the tool name and an install action", () => {
    const { getByTestId, getByText } = render(<MissingToolInlineError toolName="bash" />);
    expect(getByTestId("missing-tool-inline-error")).toBeTruthy();
    expect(getByText(/Install bash/)).toBeTruthy();
  });

  it("flags the install target and navigates to Settings → Tools on click", () => {
    const { getByText } = render(<MissingToolInlineError toolName="bash" />);
    fireEvent.click(getByText(/Install bash/));
    // Target flagged BEFORE navigation so ToolsSection consumes it on mount.
    expect(requestToolInstall).toHaveBeenCalledWith("bash");
    expect(navigate).toHaveBeenCalledWith("/settings/developer");
    // Ordering: requestToolInstall fires before navigate.
    expect(requestToolInstall.mock.invocationCallOrder[0])
      .toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });
});
