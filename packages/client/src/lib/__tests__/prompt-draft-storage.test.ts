/**
 * Prompt-answer draft store (memory-first + debounced `sessionStorage` mirror).
 * See change: fix-input-state-consistency (#1117). Test-plan rows S27-S32, S37-S39,
 * S45, S46, S56, S61, S68-S71.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePromptDraft,
  flushPromptDraft,
  getPromptDraft,
  getPromptDraftImages,
  hasPromptDraft,
  hydratePromptDrafts,
  PROMPT_DRAFT_DEBOUNCE_MS,
  PROMPT_DRAFT_KEY_PREFIX,
  PROMPT_DRAFT_MAX_ENTRY_UNITS,
  PROMPT_DRAFT_TTL_MS,
  promptDraftKey,
  promptDraftStats,
  resetPromptDraftMemory,
  setPromptDraft,
  setPromptDraftImages,
} from "../state/prompt-draft-storage.js";

const KEY = "ask-draft:s1:p1";
const mirrored = () => Object.keys(sessionStorage).filter((k) => k.startsWith(PROMPT_DRAFT_KEY_PREFIX));

/** An entry whose full serialised length is exactly `units` UTF-16 code units. */
function stateForEntryLength(units: number, savedAt: number): { text: string } {
  const overhead = JSON.stringify({ v: 1, savedAt, state: { text: "" } }).length;
  return { text: "x".repeat(units - overhead) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  sessionStorage.clear();
  resetPromptDraftMemory();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetPromptDraftMemory();
});

describe("key + shape (S27)", () => {
  it("S27: mirrors `{v:1, savedAt, state}` under exactly ask-draft:<session>:<prompt>", () => {
    setPromptDraft("s1", "p1", { text: "hi" });
    flushPromptDraft("s1", "p1");
    expect(mirrored()).toEqual([KEY]);
    expect(promptDraftKey("s1", "p1")).toBe(KEY);
    expect(JSON.parse(sessionStorage.getItem(KEY) as string)).toEqual({ v: 1, savedAt: Date.now(), state: { text: "hi" } });
  });
});

describe("debounce (S29, S38)", () => {
  it("S29: no write at 299 ms, one write at 300 ms; memory is current throughout", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    setPromptDraft("s1", "p1", { text: "a" });
    expect(PROMPT_DRAFT_DEBOUNCE_MS).toBe(300);
    vi.advanceTimersByTime(299);
    expect(spy).not.toHaveBeenCalled();
    expect(getPromptDraft("s1", "p1")).toEqual({ text: "a" });
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getPromptDraft("s1", "p1")).toEqual({ text: "a" });
  });

  it("S38: 200 keystrokes at 10 ms spacing coalesce into one write after the final idle", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    let text = "";
    for (let i = 0; i < 200; i++) {
      text += "k";
      setPromptDraft("s1", "p1", { text });
      expect((getPromptDraft("s1", "p1") as { text: string }).text).toBe(text);
      vi.advanceTimersByTime(10);
    }
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("per-entry cap (S30, S71)", () => {
  it("S30: cap is inclusive and measured in UTF-16 units of the full entry", () => {
    const now = Date.now();
    for (const [len, expectMirrored] of [
      [PROMPT_DRAFT_MAX_ENTRY_UNITS - 1, true],
      [PROMPT_DRAFT_MAX_ENTRY_UNITS, true],
      [PROMPT_DRAFT_MAX_ENTRY_UNITS + 1, false],
    ] as const) {
      sessionStorage.clear();
      resetPromptDraftMemory();
      setPromptDraft("s1", "p1", stateForEntryLength(len, now));
      vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
      expect(sessionStorage.getItem(KEY) !== null, `len ${len}`).toBe(expectMirrored);
      // The memory entry is kept either way (same-tab restore).
      expect(getPromptDraft("s1", "p1")).toBeDefined();
    }
  });

  it("S30: bytes do not count — 6 000 euro signs (~18 000 UTF-8 bytes) is mirrored", () => {
    setPromptDraft("s1", "p1", { text: "€".repeat(6000) });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });

  it("S71: an over-cap draft never calls setItem, stays restorable in-tab, and is lost on reload", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    setPromptDraft("s1", "p1", { text: "x".repeat(20_000) });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    expect((getPromptDraft("s1", "p1") as { text: string }).text).toHaveLength(20_000);
    resetPromptDraftMemory(); // reload
    expect(getPromptDraft("s1", "p1")).toBeUndefined();
  });

  it("S71: growing past the cap removes the stale smaller mirror (no resurrecting old text on reload)", () => {
    setPromptDraft("s1", "p1", { text: "small" });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    setPromptDraft("s1", "p1", { text: "x".repeat(20_000) });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("TTL sweep at hydrate (S31)", () => {
  it("S31: only entries older than 24 h are removed (exactly 24 h kept)", () => {
    const now = Date.now();
    const seed = (id: string, savedAt: number) => sessionStorage.setItem(`ask-draft:s1:${id}`, JSON.stringify({ v: 1, savedAt, state: { text: id } }));
    seed("fresh", now - (PROMPT_DRAFT_TTL_MS - 1));
    seed("exact", now - PROMPT_DRAFT_TTL_MS);
    seed("old", now - (PROMPT_DRAFT_TTL_MS + 1));
    hydratePromptDrafts();
    expect(sessionStorage.getItem("ask-draft:s1:fresh")).not.toBeNull();
    expect(sessionStorage.getItem("ask-draft:s1:exact")).not.toBeNull();
    expect(sessionStorage.getItem("ask-draft:s1:old")).toBeNull();
    expect(getPromptDraft("s1", "fresh")).toEqual({ text: "fresh" });
    expect(getPromptDraft("s1", "exact")).toEqual({ text: "exact" });
    expect(getPromptDraft("s1", "old")).toBeUndefined();
  });
});

describe("corrupt storage (S16/S70)", () => {
  it.each([
    ["not json", "{not json"],
    ["wrong version", JSON.stringify({ v: 2, savedAt: 1, state: {} })],
    ["null", "null"],
    ["array", "[]"],
    ["no state", JSON.stringify({ v: 1, savedAt: 1 })],
  ])("S70: %s is ignored and removed on hydrate", (_name, raw) => {
    sessionStorage.setItem(KEY, raw);
    expect(() => hydratePromptDrafts()).not.toThrow();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(getPromptDraft("s1", "p1")).toBeUndefined();
  });

  it("S70: a corrupt entry written after hydrate is also dropped on first read", () => {
    hydratePromptDrafts();
    sessionStorage.setItem(KEY, "{not json");
    expect(getPromptDraft("s1", "p1")).toBeUndefined();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe("storage failures degrade to memory-only (S68, S69)", () => {
  it("S68: setItem throwing (quota) is swallowed; memory stays current; flush/unmount never throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    setPromptDraft("s1", "p1", { text: "kept" });
    expect(() => vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS)).not.toThrow();
    expect(() => flushPromptDraft("s1", "p1")).not.toThrow();
    expect(getPromptDraft("s1", "p1")).toEqual({ text: "kept" });
  });

  it("S69: sessionStorage getter throwing degrades silently to memory-only", () => {
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(() => hydratePromptDrafts()).not.toThrow();
      expect(getPromptDraft("s1", "p1")).toBeUndefined();
      setPromptDraft("s1", "p1", { text: "mem" });
      expect(() => vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS)).not.toThrow();
      expect(getPromptDraft("s1", "p1")).toEqual({ text: "mem" });
    } finally {
      if (real) Object.defineProperty(window, "sessionStorage", real);
    }
  });
});

describe("flush paths (S45, S46, S61)", () => {
  it("S45: a flush inside the write delay (unmount) writes synchronously; a reload then restores it", () => {
    setPromptDraft("s1", "p1", { text: "typed" });
    vi.advanceTimersByTime(100);
    flushPromptDraft("s1", "p1");
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    resetPromptDraftMemory();
    expect(getPromptDraft("s1", "p1")).toEqual({ text: "typed" });
  });

  it("S46: pagehide flushes pending drafts", () => {
    setPromptDraft("s1", "p1", { text: "latest" });
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(sessionStorage.getItem(KEY) as string).state).toEqual({ text: "latest" });
  });

  it("S61: a flush after the draft was cleared never re-creates the key", () => {
    setPromptDraft("s1", "p1", { text: "x" });
    deletePromptDraft("s1", "p1");
    flushPromptDraft("s1", "p1");
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS * 2);
    expect(mirrored()).toEqual([]);
    expect(promptDraftStats().timers).toBe(0);
  });
});

describe("per-tab storage (S56)", () => {
  it("S56: drafts live in sessionStorage only; localStorage is untouched; a fresh context sees nothing", () => {
    setPromptDraft("s1", "p1", { text: "x" });
    vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith(PROMPT_DRAFT_KEY_PREFIX))).toEqual([]);
    // A second tab = fresh sessionStorage + fresh module memory.
    sessionStorage.clear();
    resetPromptDraftMemory();
    expect(getPromptDraft("s1", "p1")).toBeUndefined();
  });
});

describe("bounded growth (S39)", () => {
  it("S39: 500 drafts (with images) fully released after deletion — maps, timers and keys at zero", () => {
    const img = { type: "image" as const, data: "AAA", mimeType: "image/png" };
    for (let i = 0; i < 500; i++) {
      setPromptDraft("s1", `p${i}`, { text: "t".repeat(i % 50) });
      if (i % 2 === 0) {
        setPromptDraftImages("s1", `p${i}`, -1, [img]);
        setPromptDraftImages("s1", `p${i}`, 1, [img]);
      }
      if (i % 3 === 0) vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS);
    }
    expect(promptDraftStats().drafts).toBe(500);
    for (let i = 0; i < 500; i++) {
      expect(hasPromptDraft("s1", `p${i}`)).toBe(true);
      deletePromptDraft("s1", `p${i}`);
    }
    expect(promptDraftStats()).toEqual({ drafts: 0, imageEntries: 0, timers: 0 });
    expect(mirrored()).toEqual([]);
  });

  it("images are keyed by the FULL draft key: another session's same promptId never sees them", () => {
    const img = { type: "image" as const, data: "AAA", mimeType: "image/png" };
    setPromptDraftImages("A", "p1", -1, [img]);
    expect(getPromptDraftImages("A", "p1")).toEqual([img]);
    expect(getPromptDraftImages("B", "p1")).toEqual([]);
    setPromptDraftImages("A", "p1", -1, []);
    expect(promptDraftStats().imageEntries).toBe(0);
  });
});
