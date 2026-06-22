import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { applyAppHiddenClass, useAppHidden } from "../useAppHidden.js";

afterEach(() => {
  document.documentElement.classList.remove("app-hidden");
  // Restore the global visibilityState override so it doesn't leak into other
  // tests (jsdom default is "visible").
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("applyAppHiddenClass", () => {
  it("adds app-hidden when hidden and removes it when visible", () => {
    const root = document.createElement("div");
    applyAppHiddenClass(root, true);
    expect(root.classList.contains("app-hidden")).toBe(true);
    applyAppHiddenClass(root, false);
    expect(root.classList.contains("app-hidden")).toBe(false);
  });
});

describe("useAppHidden", () => {
  it("toggles app-hidden on the document root from visibilitychange", () => {
    setVisibility("visible");
    const { unmount } = renderHook(() => useAppHidden());
    expect(document.documentElement.classList.contains("app-hidden")).toBe(false);

    setVisibility("hidden");
    expect(document.documentElement.classList.contains("app-hidden")).toBe(true);

    setVisibility("visible");
    expect(document.documentElement.classList.contains("app-hidden")).toBe(false);

    unmount();
  });
});
