import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DRAFT_KEY_PREFIX,
  readAllDrafts,
  writeDraft,
  deleteDraft,
} from "../state/draft-storage.js";

describe("draft-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("readAllDrafts", () => {
    it("returns an empty Map when storage has no matching keys", () => {
      expect(readAllDrafts().size).toBe(0);
    });

    it("reads every chat-draft:* key into a Map", () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + "abc", "hello");
      window.localStorage.setItem(DRAFT_KEY_PREFIX + "def", "bye");
      const m = readAllDrafts();
      expect(m.size).toBe(2);
      expect(m.get("abc")).toBe("hello");
      expect(m.get("def")).toBe("bye");
    });

    it("ignores unrelated keys", () => {
      window.localStorage.setItem("theme", "dark");
      window.localStorage.setItem("show-debug-tools", "true");
      window.localStorage.setItem(DRAFT_KEY_PREFIX + "s1", "draft");
      const m = readAllDrafts();
      expect(m.size).toBe(1);
      expect(m.get("s1")).toBe("draft");
    });

    it("ignores an empty sessionId (chat-draft: with nothing after)", () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX, "orphan");
      expect(readAllDrafts().size).toBe(0);
    });

    it("preserves empty-string draft values when they exist in storage", () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + "sid", "");
      const m = readAllDrafts();
      expect(m.get("sid")).toBe("");
    });

    it("returns an empty Map when localStorage throws on length access", () => {
      const spy = vi
        .spyOn(window.localStorage, "key")
        .mockImplementation(() => {
          throw new Error("denied");
        });
      const result = readAllDrafts();
      expect(result.size).toBe(0);
      spy.mockRestore();
    });
  });

  describe("writeDraft", () => {
    it("persists under the chat-draft:<sessionId> key", () => {
      writeDraft("sess-1", "hello world");
      expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + "sess-1")).toBe(
        "hello world",
      );
    });

    it("round-trips via readAllDrafts", () => {
      writeDraft("a", "alpha");
      writeDraft("b", "beta");
      const m = readAllDrafts();
      expect(m.get("a")).toBe("alpha");
      expect(m.get("b")).toBe("beta");
    });

    it("ignores empty sessionId", () => {
      writeDraft("", "orphan");
      expect(readAllDrafts().size).toBe(0);
    });

    it("does not throw when setItem throws (quota / private mode)", () => {
      const spy = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });
      expect(() => writeDraft("sid", "value")).not.toThrow();
      spy.mockRestore();
    });
  });

  describe("deleteDraft", () => {
    it("removes only the target key", () => {
      writeDraft("keep", "x");
      writeDraft("drop", "y");
      deleteDraft("drop");
      const m = readAllDrafts();
      expect(m.get("keep")).toBe("x");
      expect(m.has("drop")).toBe(false);
    });

    it("is a silent no-op when the key does not exist", () => {
      expect(() => deleteDraft("never-there")).not.toThrow();
    });

    it("ignores empty sessionId", () => {
      writeDraft("real", "v");
      deleteDraft("");
      expect(readAllDrafts().get("real")).toBe("v");
    });

    it("does not throw when removeItem throws", () => {
      const spy = vi
        .spyOn(window.localStorage, "removeItem")
        .mockImplementation(() => {
          throw new Error("denied");
        });
      expect(() => deleteDraft("sid")).not.toThrow();
      spy.mockRestore();
    });
  });
});
