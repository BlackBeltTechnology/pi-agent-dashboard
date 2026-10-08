import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCardFxAttributes } from "../useCardFxAttributes.js";

const attr = (n: string) => document.documentElement.getAttribute(n);

describe("useCardFxAttributes", () => {
  it("defaults on, reflects global off, ignores folder overrides, follows Focus", () => {
    const { rerender } = renderHook(({ p }) => useCardFxAttributes(p), { initialProps: { p: {} as never } });
    expect([attr("data-fx-status"), attr("data-fx-glow")]).toEqual(["on", "on"]);
    rerender({ p: { global: { "fx-status-animation": false } } as never });
    expect([attr("data-fx-status"), attr("data-fx-glow")]).toEqual(["off", "on"]);
    rerender({ p: { folders: { "/a": { "fx-selected-glow": false } } } as never });
    expect([attr("data-fx-status"), attr("data-fx-glow")]).toEqual(["on", "on"]);
    rerender({ p: { focus: { enabled: true } } as never });
    expect([attr("data-fx-status"), attr("data-fx-glow")]).toEqual(["off", "off"]);
  });
});
