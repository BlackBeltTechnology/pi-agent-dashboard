import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { RecommendedExtensions } from "../packages/RecommendedExtensions.js";
import type { EnrichedRecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";

// ── Mocks ──────────────────────────────────────────────────────────

interface MockedRecommendedResult {
  recommended: EnrichedRecommendedExtension[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const mockRecommended = vi.fn<() => MockedRecommendedResult>();
const installSpy = vi.fn();
const statusForSpy = vi.fn<(source: string) => "idle" | "queued" | "running" | "success" | "error">();

vi.mock("../../hooks/useRecommendedExtensions.js", () => ({
  useRecommendedExtensions: () => mockRecommended(),
}));

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => ({
    operation: { operationId: null, status: "idle", message: "", source: "" },
    install: installSpy,
    remove: vi.fn(),
    update: vi.fn(),
    statusFor: (s: string) => statusForSpy(s),
    messageFor: () => "",
    queueDepth: 0,
    runningSource: null,
    handleMessage: () => {},
    clearOperation: () => {},
  }),
}));

function makeEntry(overrides: Partial<EnrichedRecommendedExtension>): EnrichedRecommendedExtension {
  return {
    id: "pi-anthropic-messages",
    source: "git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
    displayName: "pi-anthropic-messages",
    fallbackDescription: "fallback",
    status: "required",
    unlocks: [],
    description: "desc",
    version: "1.0.0",
    activeInPi: false,
    installed: { scope: null },
    ...overrides,
  } as EnrichedRecommendedExtension;
}

beforeEach(() => {
  installSpy.mockClear();
  statusForSpy.mockReset();
  statusForSpy.mockReturnValue("idle");
});

afterEach(() => {
  cleanup();
});

describe("RecommendedExtensions \u2014 Install all missing button", () => {
  it("disabled when nothing is missing", () => {
    mockRecommended.mockReturnValue({
      recommended: [
        makeEntry({ id: "a", source: "src:a", activeInPi: true }),
        makeEntry({ id: "b", source: "src:b", activeInPi: true }),
      ],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<RecommendedExtensions scope="global" />);
    const btn = screen.getByTestId("rec-install-all-missing") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("clicking enqueues every missing entry in manifest order with per-entry scope", () => {
    mockRecommended.mockReturnValue({
      recommended: [
        makeEntry({ id: "a", source: "src:a", activeInPi: false, installed: { scope: "global" } as any }),
        makeEntry({ id: "b", source: "src:b", activeInPi: true }),
        makeEntry({ id: "c", source: "src:c", activeInPi: false, installed: { scope: null } as any }),
      ],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<RecommendedExtensions scope="local" cwd="/tmp/proj" />);
    const btn = screen.getByTestId("rec-install-all-missing");
    fireEvent.click(btn);

    expect(installSpy).toHaveBeenCalledTimes(2);
    // Manifest order: a then c. b skipped (already active).
    expect(installSpy.mock.calls[0]).toEqual(["src:a", "global"]); // installed.scope wins
    expect(installSpy.mock.calls[1]).toEqual(["src:c", undefined]); // null \u2192 fallback to current scope
  });

  it("disables the bulk button while every missing entry is queued/running", () => {
    statusForSpy.mockImplementation((s: string) => {
      if (s === "src:a") return "running";
      if (s === "src:c") return "queued";
      return "idle";
    });

    mockRecommended.mockReturnValue({
      recommended: [
        makeEntry({ id: "a", source: "src:a", activeInPi: false }),
        makeEntry({ id: "b", source: "src:b", activeInPi: true }),
        makeEntry({ id: "c", source: "src:c", activeInPi: false }),
      ],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<RecommendedExtensions scope="global" />);
    const btn = screen.getByTestId("rec-install-all-missing") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows a Queued pill on cards in queued state", () => {
    statusForSpy.mockImplementation((s: string) => (s === "src:a" ? "queued" : "idle"));

    mockRecommended.mockReturnValue({
      recommended: [makeEntry({ id: "a", source: "src:a", activeInPi: false })],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<RecommendedExtensions scope="global" />);
    expect(screen.getByText("Queued")).toBeTruthy();
  });
});

describe("RecommendedExtensions — derived skills badges", () => {
  it("renders a skill badge per skillsRegistered entry", () => {
    mockRecommended.mockReturnValue({
      recommended: [
        makeEntry({
          id: "docconv",
          source: "npm:docconv",
          skillsRegistered: ["document-converter"],
        }),
      ],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<RecommendedExtensions scope="global" />);
    const row = screen.getByTestId("recommended-skills-docconv");
    expect(row.textContent).toContain("document-converter");
  });

  it("omits the skills row when the entry ships no skills", () => {
    mockRecommended.mockReturnValue({
      recommended: [makeEntry({ id: "noskill", source: "npm:noskill" })],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<RecommendedExtensions scope="global" />);
    expect(screen.queryByTestId("recommended-skills-noskill")).toBeNull();
  });
});
