/**
 * EditorView client-side start dedup — see change
 * fix-editor-settings-persistence.
 *
 * A single tab must not fire two concurrent /api/editor/start requests
 * (React StrictMode double-mount, rapid remount, heartbeat re-start
 * overlapping the initial start). Pairs with the server-side per-cwd dedup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import React, { StrictMode } from "react";

vi.mock("../ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark" }),
}));
vi.mock("../../lib/api-context.js", () => ({
  getApiBase: () => "",
}));

import { EditorView } from "../EditorView.js";

const originalFetch = globalThis.fetch;

function countStartCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    ([url]) => typeof url === "string" && url.includes("/api/editor/start"),
  ).length;
}

describe("EditorView — start dedup", () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fires /api/editor/start only once under StrictMode double-mount", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/editor/start")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { id: "abc123", status: "ready", proxyPath: "/editor/abc123/" },
          }),
        });
      }
      // heartbeat / theme / stop
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(
      <StrictMode>
        <EditorView cwd="/proj" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(countStartCalls(fetchMock)).toBeGreaterThan(0);
    });
    // Give any erroneous second start a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(countStartCalls(fetchMock)).toBe(1);
  });
});
