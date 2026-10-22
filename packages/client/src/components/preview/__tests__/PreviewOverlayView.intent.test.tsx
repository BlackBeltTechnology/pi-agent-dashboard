/**
 * Route-backed overlay provenance from a signed navigation intent
 * (change: harden-client-sinks, design D10, test-plan #X1).
 * Exemplar: FilePreviewOverlay.test.tsx.
 */
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { usePreviewOpener } from "../../../lib/access-grants/preview-provenance.js";

// Replace the renderer body with a provenance probe.
vi.mock("../PreviewCard.js", () => ({
  PreviewBody: () => {
    const opener = usePreviewOpener();
    return <div data-testid="probe" data-opener={opener} />;
  },
}));

import { PreviewOverlayView } from "../PreviewOverlayView.js";

const target: ViewTarget = { kind: "file", cwd: "/home/op/p", path: "page.html" };

function mountAt(search: string) {
  const loc = memoryLocation({ path: `/folder/x/view${search}` });
  return render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <PreviewOverlayView target={target} onBack={() => {}} />
    </Router>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** fetch that never settles unless aborted. */
const stalling = vi.fn(
  (_u: string, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
);

describe("PreviewOverlayView × intent (#X1)", () => {
  it("no ni → agent at once, no verify call", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    mountAt("?path=page.html");
    expect(screen.getByTestId("probe").getAttribute("data-opener")).toBe("agent");
    expect(f).not.toHaveBeenCalled();
  });

  it("verify aborts → agent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    mountAt("?path=page.html&ni=abc.def");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("probe").getAttribute("data-opener")).toBe("agent");
  });

  it("verify stalls → pending until 2 s, then agent (not earlier)", async () => {
    vi.stubGlobal("fetch", stalling);
    mountAt("?path=page.html&ni=abc.def");
    expect(screen.queryByTestId("probe")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1990);
    });
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(screen.getByTestId("preview-overlay-pending")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(screen.getByTestId("probe").getAttribute("data-opener")).toBe("agent");
  });

  it("verified intent → operator provenance; the target rides in the verify body", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, ok: true }) });
    vi.stubGlobal("fetch", f);
    mountAt("?path=page.html&ni=abc.def");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("probe").getAttribute("data-opener")).toBe("operator");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/nav-intent/verify");
    expect(JSON.parse(init.body as string)).toEqual({ ni: "abc.def", kind: "file-view", target: { cwd: "/home/op/p", path: "page.html" } });
  });

  it("server says ok:false → agent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, ok: false }) }));
    mountAt("?path=page.html&ni=abc.def");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("probe").getAttribute("data-opener")).toBe("agent");
  });
});
