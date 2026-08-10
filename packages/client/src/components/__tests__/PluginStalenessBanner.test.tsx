/**
 * Tests for PluginStalenessBanner — see change fix-pi-flows-end-to-end
 * (Group 6).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { PluginStalenessBanner } from "../packages/PluginStalenessBanner.js";
import { PLUGIN_REGISTRY_HASH } from "../../generated/plugin-registry.js";

const originalFetch = globalThis.fetch;

function mockFetch(json: unknown, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => json,
  }) as unknown as typeof fetch;
}

describe("PluginStalenessBanner", () => {
  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* sessionStorage unavailable in node, ignore */
    }
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders nothing when /api/health.bundleHash matches the embedded hash", async () => {
    mockFetch({ bundleHash: PLUGIN_REGISTRY_HASH });
    const { container } = render(<PluginStalenessBanner />);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='plugin-staleness-banner']")).toBeNull();
    });
  });

  it("renders the banner when hashes differ", async () => {
    mockFetch({ bundleHash: "ffeeddccbbaa00112233445566778899" });
    const { findByTestId } = render(<PluginStalenessBanner />);
    expect(await findByTestId("plugin-staleness-banner")).toBeTruthy();
  });

  it("Refresh button calls window.location.reload", async () => {
    mockFetch({ bundleHash: "ffeeddccbbaa00112233445566778899" });
    const reload = vi.fn();
    const originalLoc = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLoc, reload },
    });
    try {
      const { findByTestId } = render(<PluginStalenessBanner />);
      const btn = await findByTestId("plugin-staleness-reload");
      fireEvent.click(btn);
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLoc });
    }
  });

  it("Dismiss button hides the banner and records sessionStorage", async () => {
    mockFetch({ bundleHash: "ffeeddccbbaa00112233445566778899" });
    const { findByTestId, queryByTestId } = render(<PluginStalenessBanner />);
    const dismiss = await findByTestId("plugin-staleness-dismiss");
    fireEvent.click(dismiss);
    await waitFor(() => {
      expect(queryByTestId("plugin-staleness-banner")).toBeNull();
    });
    expect(sessionStorage.getItem("pi-plugin-staleness-dismissed")).toBe("1");
  });

  it("does not render when dismissed in sessionStorage", async () => {
    sessionStorage.setItem("pi-plugin-staleness-dismissed", "1");
    mockFetch({ bundleHash: "ffeeddccbbaa00112233445566778899" });
    const { container } = render(<PluginStalenessBanner />);
    // Give the fetch a chance to settle even though the banner is gated by sessionStorage
    await new Promise((r) => setTimeout(r, 5));
    expect(container.querySelector("[data-testid='plugin-staleness-banner']")).toBeNull();
  });

  it("renders nothing when /api/health response is malformed", async () => {
    mockFetch({});
    const { container } = render(<PluginStalenessBanner />);
    await new Promise((r) => setTimeout(r, 5));
    expect(container.querySelector("[data-testid='plugin-staleness-banner']")).toBeNull();
  });
});
