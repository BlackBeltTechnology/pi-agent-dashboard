/**
 * Tests for the bounded custom-event-group pattern matcher (worker_threads)
 * and the first-match-wins resolver with per-group quarantine.
 *
 * See change: add-custom-event-group-filters (tasks 2.1–2.3, 3.1–3.3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomEventGroupMatcher } from "../session/custom-event-group-matcher.js";
import { CustomEventGroupResolver } from "../session/custom-event-group-resolver.js";
import { RESERVED_OTHER_GROUP_ID, type CustomEventGroup } from "@blackbelt-technology/pi-dashboard-shared/custom-event-groups.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function group(id: string, pattern: string, overrides: Partial<CustomEventGroup> = {}): CustomEventGroup {
  return { id, label: id, pattern, default: true, ...overrides };
}

describe("matcher driver (task 2.1, 2.2)", () => {
  it("round-trips a match and a non-match through the worker", async () => {
    const matcher = new CustomEventGroupMatcher();
    try {
      await expect(matcher.match("^om\\.", "om.observations.recorded")).resolves.toBe(true);
      await expect(matcher.match("^om\\.", "web-search-results")).resolves.toBe(false);
    } finally {
      await matcher.dispose();
    }
  });

  it("a catastrophically-backtracking pattern completes (timeout) rather than hanging", async () => {
    const matcher = new CustomEventGroupMatcher({ timeoutMs: 80 });
    try {
      const start = Date.now();
      // Classic exponential backtracking; a naive regex.test would hang.
      await expect(matcher.match("(a+)+$", "a".repeat(40) + "b")).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(5_000);
    } finally {
      await matcher.dispose();
    }
  });

  it("respawns the worker after a timeout kill and keeps matching", async () => {
    const matcher = new CustomEventGroupMatcher({ timeoutMs: 80 });
    try {
      await expect(matcher.match("(a+)+$", "a".repeat(40) + "b")).rejects.toThrow();
      // The kill must not poison subsequent matches.
      await expect(matcher.match("^om\\.", "om.x")).resolves.toBe(true);
    } finally {
      await matcher.dispose();
    }
  });
});

describe("resolver (task 3.1, 3.2, 3.3)", () => {
  function stubMatcher(impl: (pattern: string, customType: string) => boolean | Promise<boolean>) {
    const calls: Array<{ pattern: string; customType: string }> = [];
    return {
      calls,
      match: vi.fn(async (pattern: string, customType: string) => {
        calls.push({ pattern, customType });
        return impl(pattern, customType);
      }),
    };
  }

  it("first-match-wins: an earlier user rule beats a later shipped rule", async () => {
    const stub = stubMatcher((pattern) => pattern === "^om\\.observations\\.");
    const resolver = new CustomEventGroupResolver(
      [group("user-obs", "^om\\.observations\\."), group("memory", "^om\\.")],
      stub as unknown as CustomEventGroupMatcher,
    );
    await expect(resolver.resolve("om.observations.recorded")).resolves.toBe("user-obs");
  });

  it("unmatched type falls into the reserved other", async () => {
    const stub = stubMatcher(() => false);
    const resolver = new CustomEventGroupResolver([group("memory", "^om\\.")], stub as unknown as CustomEventGroupMatcher);
    await expect(resolver.resolve("third-party.type")).resolves.toBe(RESERVED_OTHER_GROUP_ID);
  });

  it("memoizes per distinct customType — matcher invoked at most once per type", async () => {
    const stub = stubMatcher(() => false);
    const resolver = new CustomEventGroupResolver([group("memory", "^om\\.")], stub as unknown as CustomEventGroupMatcher);
    await resolver.resolve("om.x");
    await resolver.resolve("om.x");
    await resolver.resolve("om.x");
    expect(stub.match).toHaveBeenCalledTimes(1);
    // a different type resolves separately
    await resolver.resolve("om.y");
    expect(stub.match).toHaveBeenCalledTimes(2);
  });

  it("flow-event is excluded entirely — no group, no matcher call", async () => {
    const stub = stubMatcher(() => true);
    const resolver = new CustomEventGroupResolver([group("memory", "^om\\.")], stub as unknown as CustomEventGroupMatcher);
    await expect(resolver.resolve("flow-event")).resolves.toBeUndefined();
    expect(stub.match).not.toHaveBeenCalled();
  });

  it("quarantines the offending group on matcher failure and resumes at the next group", async () => {
    const callCountByPattern = new Map<string, number>();
    const stub = {
      match: vi.fn(async (pattern: string, customType: string) => {
        callCountByPattern.set(pattern, (callCountByPattern.get(pattern) ?? 0) + 1);
        if (pattern === "(a+)+$") throw new Error("worker terminated on expiry");
        return customType.startsWith("good");
      }),
    };
    const warns: string[] = [];
    const resolver = new CustomEventGroupResolver(
      [group("bad", "(a+)+$"), group("good", "^good\\.")],
      stub as unknown as CustomEventGroupMatcher,
      { warn: (m) => warns.push(m) },
    );
    // Resolution continues PAST the quarantined group to the next match.
    await expect(resolver.resolve("good.thing")).resolves.toBe("good");
    expect(warns.some((m) => m.includes("bad"))).toBe(true);

    // The quarantined group is skipped for every subsequent type...
    await expect(resolver.resolve("other.thing")).resolves.toBe(RESERVED_OTHER_GROUP_ID);
    // ...and is never re-tested (kill at most once per configured group).
    expect(callCountByPattern.get("(a+)+$")).toBe(1);
    expect(callCountByPattern.get("^good\\.")).toBe(2);
  });

  it("a file of pathological patterns cannot cause a respawn storm (task 2.3)", async () => {
    const matcher = new CustomEventGroupMatcher({ timeoutMs: 60 });
    try {
      const pathological = [group("p1", "(a+)+$"), group("p2", "(a|aa)+$"), group("p3", "(.*a){20}$")];
      const resolver = new CustomEventGroupResolver(pathological, matcher);
      const start = Date.now();
      await resolver.resolve("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab");
      expect(Date.now() - start).toBeLessThan(10_000);
      // At most one kill per configured group per process.
      expect(matcher.terminateCount()).toBeLessThanOrEqual(pathological.length);
      // Everything quarantined → later types resolve straight to other.
      await expect(resolver.resolve("zzz.unmatched")).resolves.toBe(RESERVED_OTHER_GROUP_ID);
      expect(matcher.terminateCount()).toBeLessThanOrEqual(pathological.length);
    } finally {
      await matcher.dispose();
    }
  });
});
