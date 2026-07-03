/**
 * LiveServerViewer — opaque-origin sandbox (D7) + SSRF refusal (#6.3).
 * See change: improve-content-editor (tasks §6.3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/live-server/list")) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { servers: [] } }) });
    }
    // start
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { id: "abc12345", label: "vite", host: "127.0.0.1", port: 5173, path: "/live/abc12345/" },
        }),
    });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("LiveServerViewer", () => {
  it("iframes the proxied path with allow-scripts and NO allow-same-origin (D7)", async () => {
    render(<LiveServerViewer />);
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://localhost:5173" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    const iframe = await screen.findByTestId("live-iframe");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("src")).toBe("/live/abc12345/");
  });

  it("refuses a free-form remote host before any request (SSRF)", async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<LiveServerViewer />);
    // Clear the initial list() call so we can assert no start() fires.
    fetchSpy.mockClear();
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://169.254.169.254" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    expect(await screen.findByTestId("live-error")).toBeTruthy();
    // No POST to /api/live-server/start was made.
    const posted = fetchSpy.mock.calls.some((call: any[]) => {
      const [u, init] = call;
      return typeof u === "string" && u.includes("/start") && init?.method === "POST";
    });
    expect(posted).toBe(false);
    expect(screen.queryByTestId("live-iframe")).toBeNull();
  });
});
