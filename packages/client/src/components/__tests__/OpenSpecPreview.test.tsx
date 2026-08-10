import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { OpenSpecPreview } from "../../App.js";
import { buildOpenSpecPreviewUrl } from "../../lib/nav/route-builders.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Mock the reader hook so the component renders without network/fetch.
// The hook now derives `activeTab` from the `initialArtifact` argument.
vi.mock("../../hooks/useOpenSpecReader.js", () => ({
  useOpenSpecReader: (
    _cwd: string,
    changeName: string,
    initialArtifact: string,
  ) => ({
    content: `# ${initialArtifact} content`,
    isLoading: false,
    error: undefined,
    tabs: [
      { id: "proposal", label: "Proposal", colorClass: "" },
      { id: "design", label: "Design", colorClass: "" },
      { id: "specs", label: "Specs", colorClass: "" },
    ],
    activeTab: initialArtifact,
    title: changeName,
  }),
}));

const CWD = "/home/user/project";
const CHANGE = "my-change";

function makeOpenSpecMap(): Map<string, OpenSpecData> {
  return new Map<string, OpenSpecData>([
    [
      CWD,
      {
        changes: [
          {
            name: CHANGE,
            artifacts: [
              { id: "proposal", status: "done" },
              { id: "design", status: "ready" },
              { id: "specs", status: "ready" },
            ],
          },
        ],
      } as OpenSpecData,
    ],
  ]);
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => cleanup());

function renderPreview(initialArtifact: string) {
  const { hook } = memoryLocation({
    path: buildOpenSpecPreviewUrl(CWD, CHANGE, initialArtifact),
    record: true,
  });
  const seen: string[] = [];
  function Capture() {
    const [loc] = hook();
    seen.push(loc);
    return null;
  }
  render(
    <ThemeProvider>
      <Router hook={hook}>
        <Capture />
        <OpenSpecPreview
          cwd={CWD}
          changeName={CHANGE}
          initialArtifact={initialArtifact}
          openspecMap={makeOpenSpecMap()}
          onBack={() => {}}
        />
      </Router>
    </ThemeProvider>,
  );
  return { seen };
}

describe("OpenSpecPreview tab → URL wiring", () => {
  it("renders the artifact for the initial URL segment", () => {
    renderPreview("proposal");
    expect(screen.getByText(/proposal content/)).toBeTruthy();
  });

  it("navigates to the artifact preview URL when a tab is clicked (push)", () => {
    const { seen } = renderPreview("proposal");

    fireEvent.click(screen.getByText("Design"));

    const last = seen[seen.length - 1];
    expect(last).toBe(buildOpenSpecPreviewUrl(CWD, CHANGE, "design"));
  });

  it("shows the active tab derived from the initial artifact", () => {
    renderPreview("design");
    expect(screen.getByText(/design content/)).toBeTruthy();
  });
});
