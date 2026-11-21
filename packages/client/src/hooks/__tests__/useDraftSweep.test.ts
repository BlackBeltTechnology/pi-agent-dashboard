/**
 * State-driven prompt-draft clearing. See change: fix-input-state-consistency
 * (#1117). Test-plan rows S37 (no storage write per event), S57, S58, S60.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractiveUiRequest } from "../../lib/chat/event-reducer.js";
import {
  getPromptDraft,
  getPromptDraftImages,
  hasPromptDraft,
  PROMPT_DRAFT_DEBOUNCE_MS,
  PROMPT_DRAFT_KEY_PREFIX,
  promptDraftStats,
  resetPromptDraftMemory,
  setPromptDraft,
  setPromptDraftImages,
} from "../../lib/state/prompt-draft-storage.js";
import { sweepPromptDrafts, useDraftSweep } from "../useDraftSweep.js";

const img = { type: "image" as const, data: "AAA", mimeType: "image/png" };
const req = (requestId: string, status: InteractiveUiRequest["status"]): InteractiveUiRequest => ({ requestId, method: "input", params: {}, status });
const states = (entries: Array<[string, InteractiveUiRequest[]]>) => new Map(entries.map(([id, interactiveRequests]) => [id, { interactiveRequests }]));
const mirrored = () => Object.keys(sessionStorage).filter((k) => k.startsWith(PROMPT_DRAFT_KEY_PREFIX));

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  resetPromptDraftMemory();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetPromptDraftMemory();
});

describe("clearing is driven by request status", () => {
  it.each(["resolved", "cancelled", "dismissed"] as const)("S57: a %s request drops its draft, images (all steps) and pending timer", (status) => {
    setPromptDraft("s1", "p1", { text: "x" });
    setPromptDraftImages("s1", "p1", -1, [img]);
    setPromptDraftImages("s1", "p1", 2, [img]);
    sweepPromptDrafts(states([["s1", [req("p1", status)]]]));
    expect(sessionStorage.getItem("ask-draft:s1:p1")).toBeNull();
    expect(getPromptDraft("s1", "p1")).toBeUndefined();
    expect(getPromptDraftImages("s1", "p1")).toEqual([]);
    expect(promptDraftStats()).toEqual({ drafts: 0, imageEntries: 0, timers: 0 });
    // A later unmount-style flush / pagehide does not re-create the key.
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS * 2);
    window.dispatchEvent(new Event("pagehide"));
    expect(mirrored()).toEqual([]);
  });

  it("a pending request keeps its draft", () => {
    setPromptDraft("s1", "p1", { text: "x" });
    sweepPromptDrafts(states([["s1", [req("p1", "pending")]]]));
    expect(getPromptDraft("s1", "p1")).toEqual({ text: "x" });
  });

  it("S58: cleared with no renderer mounted (answered in the terminal / session ended)", () => {
    setPromptDraft("s1", "p1", { text: "x" });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(sessionStorage.getItem("ask-draft:s1:p1")).not.toBeNull();
    // First state: still pending. Then the terminal answers → status flips; no component involved.
    const { rerender } = renderHook(({ s }) => useDraftSweep(s), { initialProps: { s: states([["s1", [req("p1", "pending")]]]) } });
    expect(hasPromptDraft("s1", "p1")).toBe(true);
    rerender({ s: states([["s1", [req("p1", "dismissed")]]]) });
    expect(hasPromptDraft("s1", "p1")).toBe(false);
    expect(sessionStorage.getItem("ask-draft:s1:p1")).toBeNull();
  });

  it("S58: an ended session's still-'pending' requests are swept (session_removed does not flip them)", () => {
    setPromptDraft("s1", "p1", { text: "x" });
    sweepPromptDrafts(new Map([["s1", { status: "ended" as const, interactiveRequests: [req("p1", "pending")] }]]));
    expect(hasPromptDraft("s1", "p1")).toBe(false);
  });

  it("a draft persisted before a reload is swept too (hydrated into memory first)", () => {
    sessionStorage.setItem("ask-draft:s1:p1", JSON.stringify({ v: 1, savedAt: Date.now(), state: { text: "old" } }));
    sweepPromptDrafts(states([["s1", [req("p1", "resolved")]]]));
    expect(sessionStorage.getItem("ask-draft:s1:p1")).toBeNull();
  });
});

describe("sweep cost", () => {
  it("S37: 1 000 re-runs over 50 resolved requests with no draft and 5 pending with drafts write nothing", () => {
    const resolved = Array.from({ length: 50 }, (_, i) => req(`r${i}`, "resolved"));
    const pending = Array.from({ length: 5 }, (_, i) => req(`q${i}`, "pending"));
    for (const p of pending) setPromptDraft("s1", p.requestId, { text: p.requestId });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const state = states([["s1", [...resolved, ...pending]]]);
    for (let i = 0; i < 1000; i++) sweepPromptDrafts(state);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    for (const p of pending) expect(getPromptDraft("s1", p.requestId)).toEqual({ text: p.requestId });
  });

  it("S60: a resolved request with a draft is cleared once; the second run writes nothing", () => {
    setPromptDraft("s1", "p1", { text: "x" });
    const state = states([["s1", [req("p1", "resolved")]]]);
    sweepPromptDrafts(state);
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    sweepPromptDrafts(state);
    expect(removeItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
