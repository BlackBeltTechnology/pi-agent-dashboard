/**
 * Component tests for `WhatsNewDialog`.
 *
 * See change: pi-update-whats-new-panel.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { WhatsNewDialog, type WhatsNewDialogProps } from "../packages/WhatsNewDialog.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
import type {
  ChangelogResponse,
  ChangelogRelease,
} from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";

function makeRelease(
  version: string,
  partial: Partial<ChangelogRelease> = {},
): ChangelogRelease {
  return {
    version,
    date: "2026-04-23",
    breaking: [],
    features: [],
    changed: [],
    fixed: [],
    raw: "",
    ...partial,
  };
}

function makeResponse(releases: ChangelogRelease[], hasBreaking: boolean): ChangelogResponse {
  return {
    pkg: "@mariozechner/pi-coding-agent",
    from: "0.62.0",
    to: "0.70.0",
    releases,
    hasBreaking,
    changelogUrl: "https://github.com/badlogic/pi-mono/blob/main/CHANGELOG.md",
    parsedAt: new Date().toISOString(),
  };
}

function renderDialog(props: Partial<WhatsNewDialogProps> = {}) {
  const merged: WhatsNewDialogProps = {
    open: true,
    response: makeResponse([], false),
    displayName: "pi",
    latestVersion: "0.70.0",
    onClose: () => {},
    onUpdate: () => {},
    ...props,
  };
  return render(
    <ThemeProvider>
      <WhatsNewDialog {...merged} />
    </ThemeProvider>,
  );
}

describe("WhatsNewDialog", () => {
  afterEach(() => cleanup());

  it("renders nothing when open is false", () => {
    const { container } = renderDialog({ open: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders title with displayName and version range", () => {
    renderDialog({ displayName: "pi (core agent)" });
    expect(screen.getByText(/What.s new in/)).toBeTruthy();
    expect(screen.getByText("pi (core agent)", { exact: false })).toBeTruthy();
    expect(screen.getByText(/0\.62\.0 → 0\.70\.0/)).toBeTruthy();
  });

  it("pins Breaking Changes section at the top when hasBreaking is true", () => {
    const releases = [
      makeRelease("0.70.0", {
        breaking: [{ text: "broke X", issues: [] }],
        fixed: [{ text: "fixed Y", issues: [] }],
      }),
    ];
    renderDialog({ response: makeResponse(releases, true) });
    expect(screen.getByTestId("whats-new-breaking")).toBeTruthy();
    expect(screen.getByText(/1 breaking change since/)).toBeTruthy();
    expect(screen.getByText("broke X")).toBeTruthy();
  });

  it("does not render Breaking section when hasBreaking is false", () => {
    const releases = [makeRelease("0.70.0", { fixed: [{ text: "fixed Y", issues: [] }] })];
    renderDialog({ response: makeResponse(releases, false) });
    expect(screen.queryByTestId("whats-new-breaking")).toBeNull();
  });

  it("renders Other changes section collapsed by default and expands on click", () => {
    const releases = [
      makeRelease("0.70.0", { fixed: [{ text: "fixed Y", issues: [] }] }),
    ];
    renderDialog({ response: makeResponse(releases, false) });
    const toggle = screen.getByTestId("whats-new-other-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("fixed Y")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("fixed Y")).toBeTruthy();
  });

  it("renders empty-state message when releases is empty", () => {
    renderDialog({ response: makeResponse([], false) });
    expect(screen.getByTestId("whats-new-empty")).toBeTruthy();
  });

  it("renders GitHub link when changelogUrl is non-null", () => {
    renderDialog({ response: makeResponse([], false) });
    const link = screen.getByTestId("whats-new-github-link") as HTMLAnchorElement;
    expect(link.href).toBe("https://github.com/badlogic/pi-mono/blob/main/CHANGELOG.md");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("hides GitHub link when changelogUrl is null", () => {
    const resp = { ...makeResponse([], false), changelogUrl: null };
    renderDialog({ response: resp });
    expect(screen.queryByTestId("whats-new-github-link")).toBeNull();
  });

  it("Cancel button invokes onClose", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByTestId("whats-new-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Update CTA invokes onClose THEN onUpdate", () => {
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push("close"));
    const onUpdate = vi.fn(() => calls.push("update"));
    renderDialog({ onClose, onUpdate });
    fireEvent.click(screen.getByTestId("whats-new-update"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["close", "update"]);
  });

  it("Esc key invokes onClose", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
