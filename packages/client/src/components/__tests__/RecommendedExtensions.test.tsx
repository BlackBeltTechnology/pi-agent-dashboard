import type { EnrichedRecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendedExtensions } from "../packages/RecommendedExtensions.js";

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
    id: "example-required-ext",
    source: "git@github.com:example/example-required-ext.git",
    displayName: "example-required-ext",
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

// See change: addons-hub-declutter (task 4.3; test-plan E9)
describe("RecommendedExtensions \u2014 hideGlobalInstalled (recommended once)", () => {
  const flows = () => makeEntry({ id: "pi-flows", source: "src:flows", displayName: "pi-flows", activeInPi: true, installed: { scope: "global" } });
  const simplify = () =>
    makeEntry({ id: "pi-simplify", source: "src:simplify", displayName: "pi-simplify", activeInPi: true, installed: { scope: "local" } });
  const imageFit = () =>
    makeEntry({ id: "pi-image-fit", source: "src:image-fit", displayName: "pi-image-fit", activeInPi: false, installed: { scope: null } });

  function show(recommended: EnrichedRecommendedExtension[], hide = true) {
    mockRecommended.mockReturnValue({ recommended, isLoading: false, error: null, refresh: vi.fn() });
    render(<RecommendedExtensions scope="global" hideGlobalInstalled={hide} />);
  }

  it("E9: omits a globally installed entry, keeps a folder-only install and a missing one", () => {
    show([flows(), simplify(), imageFit()]);
    expect(screen.queryByText("pi-flows")).toBeNull();
    const simplifyCard = screen.getByText("pi-simplify").closest("div.border") as HTMLElement;
    expect(simplifyCard.textContent).toContain("Local");
    const missing = screen.getByText("pi-image-fit").closest("div.border") as HTMLElement;
    expect(missing.textContent).toContain("Install");
  });

  it("E9: shows every entry when hideGlobalInstalled is off (folder behaviour unchanged)", () => {
    show([flows(), simplify(), imageFit()], false);
    expect(screen.getByText("pi-flows")).toBeTruthy();
  });

  it("E9: all-installed state renders one line instead of an empty grid", () => {
    show([flows(), makeEntry({ id: "x", source: "src:x", displayName: "x-ext", activeInPi: true, installed: { scope: "global" } })]);
    expect(screen.getByTestId("rec-all-installed").textContent).toMatch(/all recommended add-ons are installed/i);
    expect(screen.queryByText("pi-flows")).toBeNull();
  });

  it("keeps Install all missing counting entries hidden from the grid", () => {
    // Globally on disk but not active in pi: still a card (it would otherwise vanish from the page).
    const inactive = makeEntry({ id: "off", source: "src:off", displayName: "off-ext", activeInPi: false, installed: { scope: "global" } });
    show([flows(), inactive]);
    expect(screen.getByText("off-ext")).toBeTruthy();
    expect((screen.getByTestId("rec-install-all-missing") as HTMLButtonElement).disabled).toBe(false);
  });
});

// See change: addons-hub-feature-catalog (task 6.3; test-plan E26)
describe("RecommendedExtensions \u2014 hub-off entries (Discover tab)", () => {
  const entry = (id: string, extra: Partial<EnrichedRecommendedExtension>) =>
    makeEntry({ id, source: `src:${id}`, displayName: id, ...extra });

  it("E26: a feature turned off by the hub has no card; the other states keep theirs", () => {
    mockRecommended.mockReturnValue({
      recommended: [
        entry("pi-flows", { activeInPi: false, installed: { scope: "global" } as any }), // off by the hub
        entry("global-inactive", { activeInPi: false, installed: { scope: "global" } as any }), // inactive for another reason
        entry("pi-simplify", { activeInPi: true, installed: { scope: "local" } as any }), // folder only
        entry("pi-image-fit", { activeInPi: false, installed: { scope: null } as any }), // not installed
        entry("active-global", { activeInPi: true, installed: { scope: "global" } as any }),
      ],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<RecommendedExtensions scope="global" hideGlobalInstalled hubOffSources={["src:pi-flows"]} />);
    expect(screen.queryByText("pi-flows")).toBeNull();
    expect(screen.queryByText("active-global")).toBeNull();
    expect((screen.getByText("global-inactive").closest("div.border") as HTMLElement).textContent).toMatch(/Activate/);
    expect((screen.getByText("pi-simplify").closest("div.border") as HTMLElement).textContent).toContain("Local");
    expect((screen.getByText("pi-image-fit").closest("div.border") as HTMLElement).textContent).toContain("Install");
  });

  it("Install all missing never re-installs a hub-off entry", () => {
    mockRecommended.mockReturnValue({
      recommended: [
        entry("pi-flows", { activeInPi: false, installed: { scope: "global" } as any }),
        entry("pi-image-fit", { activeInPi: false, installed: { scope: null } as any }),
      ],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
    });
    render(<RecommendedExtensions scope="global" hideGlobalInstalled hubOffSources={["src:pi-flows"]} />);
    fireEvent.click(screen.getByTestId("rec-install-all-missing"));
    expect(installSpy.mock.calls.map((c) => c[0])).toEqual(["src:pi-image-fit"]);
  });
});
