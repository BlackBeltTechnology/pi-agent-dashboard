/**
 * Tests for the per-folder search helpers in session-grouping.ts:
 *   - filterByQuery
 *   - rankActiveFirst
 *
 * See change: pin-and-search-sessions §8.
 */
import { describe, it, expect } from "vitest";
import { filterByQuery, rankActiveFirst } from "../session/session-grouping.js";

describe("filterByQuery", () => {
  it("returns full input on empty query", () => {
    const sessions = [{ name: "Foo" }, { name: "Bar" }];
    expect(filterByQuery(sessions, "")).toEqual(sessions);
  });

  it("returns full input on whitespace-only query", () => {
    const sessions = [{ name: "Foo" }, { name: "Bar" }];
    expect(filterByQuery(sessions, "   ")).toEqual(sessions);
  });

  it("matches case-insensitively against name", () => {
    const sessions = [
      { name: "Refactor Auth" },
      { name: "Build pipeline" },
    ];
    expect(filterByQuery(sessions, "AUTH")).toEqual([{ name: "Refactor Auth" }]);
  });

  it("falls back to firstMessage when name is absent", () => {
    const sessions = [
      { firstMessage: "Explore dashboard server architecture" },
      { firstMessage: "Update README" },
    ];
    expect(filterByQuery(sessions, "dashboard")).toEqual([
      { firstMessage: "Explore dashboard server architecture" },
    ]);
  });

  it("prefers name over firstMessage", () => {
    const sessions = [
      { name: "auth", firstMessage: "completely unrelated text" },
      { name: "billing", firstMessage: "auth would match here" },
    ];
    // Query "auth" matches the first by name; the second is NOT matched
    // because filterByQuery only looks at firstMessage when name is absent.
    expect(filterByQuery(sessions, "auth")).toEqual([
      { name: "auth", firstMessage: "completely unrelated text" },
    ]);
  });

  it("returns empty array when nothing matches", () => {
    const sessions = [{ name: "Foo" }];
    expect(filterByQuery(sessions, "xyz")).toEqual([]);
  });

  it("handles missing both name and firstMessage gracefully", () => {
    const sessions = [{}, { name: "Foo" }];
    expect(filterByQuery(sessions, "foo")).toEqual([{ name: "Foo" }]);
  });

  it("trims leading/trailing whitespace in query", () => {
    const sessions = [{ name: "hello world" }];
    expect(filterByQuery(sessions, "  hello  ")).toEqual([{ name: "hello world" }]);
  });

  it("does not mutate input", () => {
    const sessions = [{ name: "a" }, { name: "b" }];
    filterByQuery(sessions, "a");
    expect(sessions).toEqual([{ name: "a" }, { name: "b" }]);
  });
});

describe("rankActiveFirst", () => {
  it("returns input unchanged when no ended sessions", () => {
    const sessions = [
      { id: "a", status: "active" },
      { id: "b", status: "streaming" },
    ];
    expect(rankActiveFirst(sessions)).toEqual(sessions);
  });

  it("places ended sessions after active ones", () => {
    const sessions = [
      { id: "ended-1", status: "ended" },
      { id: "active-1", status: "active" },
      { id: "ended-2", status: "ended" },
      { id: "active-2", status: "streaming" },
    ];
    const ranked = rankActiveFirst(sessions);
    expect(ranked.map((s) => s.id)).toEqual(["active-1", "active-2", "ended-1", "ended-2"]);
  });

  it("preserves relative order within each tier", () => {
    const sessions = [
      { id: "a", status: "active" },
      { id: "b", status: "active" },
      { id: "c", status: "ended" },
      { id: "d", status: "ended" },
    ];
    const ranked = rankActiveFirst(sessions);
    expect(ranked.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate the input array", () => {
    const sessions = [
      { id: "a", status: "ended" },
      { id: "b", status: "active" },
    ];
    rankActiveFirst(sessions);
    expect(sessions.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("treats sessions with missing status as active (ranked above ended)", () => {
    const sessions = [
      { id: "no-status" },
      { id: "ended", status: "ended" },
      { id: "active", status: "active" },
    ];
    const ranked = rankActiveFirst(sessions);
    expect(ranked.map((s) => s.id)).toEqual(["no-status", "active", "ended"]);
  });
});
