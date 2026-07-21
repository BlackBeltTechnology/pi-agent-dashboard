import { describe, it, expect } from "vitest";
import { buildContextUsageMap } from "../context-usage.js";
import type { ContextUsageInfo } from "../../components/session/SessionList.js";

describe("buildContextUsageMap", () => {
  it("uses the live event-reducer value when present", () => {
    const states = new Map([["s1", { contextUsage: { tokens: 5000, contextWindow: 200000 } }]]);
    const sessions = new Map([["s1", { contextTokens: 999, contextWindow: 999 }]]);
    const map = buildContextUsageMap(states, sessions);
    expect(map.get("s1")).toEqual({ tokens: 5000, contextWindow: 200000 });
  });

  it("falls back to persisted contextTokens + contextWindow when no live value", () => {
    // Header must show the same filled bar as the card before any live turn.
    const states = new Map<string, { contextUsage?: ContextUsageInfo }>([["s1", {}]]);
    const sessions = new Map([["s1", { contextTokens: 42000, contextWindow: 256000 }]]);
    const map = buildContextUsageMap(states, sessions);
    expect(map.get("s1")).toEqual({ tokens: 42000, contextWindow: 256000 });
  });

  it("omits sessions with neither live nor persisted usage", () => {
    const states = new Map<string, { contextUsage?: ContextUsageInfo }>([["s1", {}]]);
    const sessions = new Map([["s1", {}]]);
    const map = buildContextUsageMap(states, sessions);
    expect(map.has("s1")).toBe(false);
  });

  it("treats persisted contextTokens of 0 as valid (tokens=0, not omitted)", () => {
    const states = new Map<string, { contextUsage?: ContextUsageInfo }>();
    const sessions = new Map([["s1", { contextTokens: 0, contextWindow: 256000 }]]);
    const map = buildContextUsageMap(states, sessions);
    expect(map.get("s1")).toEqual({ tokens: 0, contextWindow: 256000 });
  });
});
