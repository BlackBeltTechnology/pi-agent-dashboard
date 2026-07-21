/**
 * After overlay-url-routing: useContentViews is a thin wrapper that turns
 * action callbacks (open pi-resources / view file) into
 * navigate() calls. There is no internal state to assert anymore.
 *
 * See change: overlay-url-routing.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { encodeFolderPath } from "../../lib/util/folder-encoding.js";
import { useContentViews } from "../useContentViews.js";

describe("useContentViews", () => {
  it("handleOpenPiResources navigates to the Directory Settings page", () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => useContentViews({ navigate }));

    act(() => result.current.handleOpenPiResources("/some/cwd"));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(`/folder/${encodeFolderPath("/some/cwd")}/settings`);
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
