/**
 * After overlay-url-routing: useContentViews is a thin wrapper that turns
 * action callbacks (open pi-resources / view file) into
 * navigate() calls. There is no internal state to assert anymore.
 *
 * See change: overlay-url-routing.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useContentViews } from "../useContentViews.js";
import { encodeFolderPath } from "../../lib/folder-encoding.js";

describe("useContentViews", () => {
  it("handleOpenPiResources navigates to /folder/:encodedCwd/pi-resources", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useContentViews({ navigate }));

    act(() => result.current.handleOpenPiResources("/some/cwd"));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(`/folder/${encodeFolderPath("/some/cwd")}/pi-resources`);
  });

  it("handleViewPiResourceFile navigates to /pi-resource with query string", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useContentViews({ navigate }));

    act(() => result.current.handleViewPiResourceFile("/abs/file.ts", "file.ts"));

    expect(navigate).toHaveBeenCalledOnce();
    const url = navigate.mock.calls[0][0] as string;
    expect(url.startsWith("/pi-resource?")).toBe(true);
    const qs = new URLSearchParams(url.slice("/pi-resource?".length));
    expect(qs.get("path")).toBe("/abs/file.ts");
    expect(qs.get("title")).toBe("file.ts");
  });
});
