import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { PackageBrowser } from "../packages/PackageBrowser.js";

// Hook mocks ---------------------------------------------------------

const mockOps = {
  operation: { operationId: null, status: "idle", message: "", source: "" } as any,
  install: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  statusFor: () => "idle" as const,
  messageFor: () => "",
  queueDepth: 0,
  runningSource: null,
  handleMessage: () => {},
  clearOperation: () => {},
};

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => mockOps,
}));
vi.mock("../../hooks/usePackageSearch.js", () => ({
  usePackageSearch: () => ({
    query: "",
    setQuery: () => {},
    typeFilter: null,
    setTypeFilter: () => {},
    packages: [],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../hooks/useInstalledPackages.js", () => ({
  useInstalledPackages: () => ({ packages: [], refresh: vi.fn() }),
}));
vi.mock("../../hooks/useRecommendedExtensions.js", () => ({
  useRecommendedExtensions: () => ({ recommended: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

beforeEach(() => {
  mockOps.operation = { operationId: null, status: "idle", message: "", source: "" } as any;
  mockOps.queueDepth = 0;
});
afterEach(() => cleanup());

describe("PackageBrowser banner", () => {
  it("hidden when idle", () => {
    render(<PackageBrowser scope="global" />);
    expect(screen.queryByTestId("package-op-banner")).toBeNull();
  });

  it("running with empty queue shows 'Installing <source>\u2026' without queue suffix", () => {
    mockOps.operation = { operationId: "op-1", status: "running", message: "doing", source: "npm:foo" } as any;
    mockOps.queueDepth = 0;
    render(<PackageBrowser scope="global" />);
    const el = screen.getByTestId("package-op-banner");
    expect(el.textContent).toContain("Installing npm:foo");
    expect(el.textContent).not.toContain("queued");
  });

  it("running with queue depth shows '(N queued)'", () => {
    mockOps.operation = { operationId: "op-1", status: "running", message: "doing", source: "npm:foo" } as any;
    mockOps.queueDepth = 2;
    render(<PackageBrowser scope="global" />);
    const el = screen.getByTestId("package-op-banner");
    expect(el.textContent).toContain("Installing npm:foo");
    expect(el.textContent).toContain("(2 queued)");
  });

  it("success state preserved (no queue suffix)", () => {
    mockOps.operation = { operationId: "op-1", status: "success", message: "install complete", source: "npm:foo" } as any;
    mockOps.queueDepth = 0;
    render(<PackageBrowser scope="global" />);
    const el = screen.getByTestId("package-op-banner");
    expect(el.textContent).toContain("install complete");
  });
});
