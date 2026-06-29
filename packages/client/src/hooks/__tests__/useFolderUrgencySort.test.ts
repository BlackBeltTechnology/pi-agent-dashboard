import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FOLDER_URGENCY_SORT_KEY, useFolderUrgencySort } from "../useFolderUrgencySort.js";

beforeEach(() => {
  localStorage.removeItem(FOLDER_URGENCY_SORT_KEY);
});

describe("useFolderUrgencySort", () => {
  it("defaults to OFF for any folder", () => {
    const { result } = renderHook(() => useFolderUrgencySort());
    expect(result.current.isOn("/a")).toBe(false);
  });

  it("toggle turns a folder ON then OFF", () => {
    const { result } = renderHook(() => useFolderUrgencySort());
    act(() => result.current.toggle("/a"));
    expect(result.current.isOn("/a")).toBe(true);
    act(() => result.current.toggle("/a"));
    expect(result.current.isOn("/a")).toBe(false);
  });

  it("persists to localStorage and restores on remount", () => {
    const first = renderHook(() => useFolderUrgencySort());
    act(() => first.result.current.toggle("/a"));
    expect(JSON.parse(localStorage.getItem(FOLDER_URGENCY_SORT_KEY)!)).toContain("/a");

    // Remount: a fresh hook instance reads the persisted set.
    const second = renderHook(() => useFolderUrgencySort());
    expect(second.result.current.isOn("/a")).toBe(true);
  });

  it("tracks folders independently", () => {
    const { result } = renderHook(() => useFolderUrgencySort());
    act(() => result.current.toggle("/a"));
    expect(result.current.isOn("/a")).toBe(true);
    expect(result.current.isOn("/b")).toBe(false);
  });
});
