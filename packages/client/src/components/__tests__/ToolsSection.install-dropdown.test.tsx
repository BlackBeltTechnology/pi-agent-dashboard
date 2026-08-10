/**
 * Tests for the Settings → Tools `[Install ▾]` dropdown.
 *
 * Covers: dropdown visibility (missing vs found), per-OS filtering,
 * copy-to-clipboard wiring, and the docs link. See change:
 * register-bash-and-tool-install-help.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import React from "react";
import type { ToolListEntry } from "../../lib/api/tools-api.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

const copyText = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/util/clipboard.js", () => ({ copyText: (...a: unknown[]) => copyText(...a) }));

// Host OS fixed to win32 so we can assert per-OS filtering.
vi.mock("../../hooks/useHostPlatform.js", () => ({
  useHostPlatform: () => "win32",
}));

const fetchTools = vi.fn();
vi.mock("../../lib/api/tools-api.js", () => ({
  fetchTools: () => fetchTools(),
  rescanAll: vi.fn(),
  rescanOne: vi.fn(),
  setOverride: vi.fn(),
  clearOverride: vi.fn(),
  downloadDiagnostics: vi.fn(),
}));

import { ToolsSection } from "../settings/ToolsSection.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const missingBash: ToolListEntry = {
  name: "bash",
  ok: false,
  path: null,
  source: null,
  tried: [{ strategy: "where", result: "not found on PATH" }],
  resolvedAt: 0,
  installHints: {
    docsAnchor: "install-bash",
    darwin: { commands: { brew: "brew install bash" } },
    win32: {
      commands: { winget: "winget install --id Git.Git -e", scoop: "scoop install git" },
      url: "https://gitforwindows.org/",
    },
    linux: { manual: "Pre-installed." },
  },
};

const foundGit: ToolListEntry = {
  name: "git",
  ok: true,
  path: "/usr/bin/git",
  source: "system",
  tried: [{ strategy: "where", result: "ok" }],
  resolvedAt: 0,
  installHints: {
    docsAnchor: "install-git",
    win32: { commands: { winget: "winget install --id Git.Git -e" } },
  },
};

describe("ToolsSection [Install ▾] dropdown", () => {
  beforeEach(() => {
    fetchTools.mockResolvedValue([missingBash, foundGit]);
    copyText.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders [Install] only on the missing row, not the found row", async () => {
    const { findByText, getByText } = render(<ToolsSection />);
    // bash row (missing) has an Install button.
    await findByText("Install");
    // Exactly one Install button (git is ok → no button).
    const installButtons = document.querySelectorAll("[aria-expanded]");
    // Only the bash Install button carries aria-expanded.
    expect(installButtons.length).toBe(1);
    expect(getByText("git")).toBeTruthy();
  });

  it("shows only host-OS (win32) commands when opened", async () => {
    const { findByText } = render(<ToolsSection />);
    fireEvent.click(await findByText("Install"));
    const region = await findRegion("Install bash");
    // win32 commands present.
    expect(within(region).getByText("winget")).toBeTruthy();
    expect(within(region).getByText("scoop")).toBeTruthy();
    // darwin/linux package managers NOT shown.
    expect(within(region).queryByText("brew")).toBeNull();
    expect(within(region).queryByText("Pre-installed.")).toBeNull();
  });

  it("copies the command to the clipboard", async () => {
    const { findByText } = render(<ToolsSection />);
    fireEvent.click(await findByText("Install"));
    const region = await findRegion("Install bash");
    const copyBtn = within(region).getByLabelText("Copy winget command");
    fireEvent.click(copyBtn);
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("winget install --id Git.Git -e"));
  });

  it("renders a docs link pointing at the tool's faq anchor", async () => {
    const { findByText } = render(<ToolsSection />);
    fireEvent.click(await findByText("Install"));
    const region = await findRegion("Install bash");
    const docs = within(region).getByText(/Read more in docs/);
    expect(docs.closest("a")?.getAttribute("href")).toBe("/docs/faq.md#install-bash");
  });
});

/** Find the install dropdown region by its aria-label. */
async function findRegion(label: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = document.querySelector(`[role="region"][aria-label="${label}"]`);
    if (!el) throw new Error(`region "${label}" not found`);
    return el as HTMLElement;
  });
}
