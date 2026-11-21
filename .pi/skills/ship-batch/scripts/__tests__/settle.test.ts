import { describe, expect, it } from "vitest";
import { settled } from "../scheduler.ts";
import { PARAMS, T0 } from "./helpers.ts";

const NOW = T0 + 1_000_000;
const it0 = (over: object) => ({ idleSince: null as number | null, streamedSincePrompt: false, lastPromptAt: NOW - 1000, ...over });

describe("#E14 settle rule", () => {
  const s = (item: ReturnType<typeof it0>, status: "idle" | "ended" | "streaming" | "active", hasQuestion = false) =>
    settled(item, { status, hasQuestion }, NOW, PARAMS);

  it("(1) ended settles", () => expect(s(it0({}), "ended")).toBe(true));
  it("(2) streamed, idle 29 s -> not yet", () =>
    expect(s(it0({ streamedSincePrompt: true, idleSince: NOW - 29_000 }), "idle")).toBe(false));
  it("(3) streamed, idle 30 s -> settled", () =>
    expect(s(it0({ streamedSincePrompt: true, idleSince: NOW - 30_000 }), "idle")).toBe(true));
  it("(4) never streamed, prompt age 4:59, idle -> not settled", () =>
    expect(s(it0({ lastPromptAt: NOW - 299_000, idleSince: NOW - 60_000 }), "idle")).toBe(false));
  it("(5) never streamed, prompt age 5:00 + idle 30 s -> settled", () =>
    expect(s(it0({ lastPromptAt: NOW - 300_000, idleSince: NOW - 30_000 }), "idle")).toBe(true));
  it("(6) case 3 + pending question -> not settled", () =>
    expect(s(it0({ streamedSincePrompt: true, idleSince: NOW - 30_000 }), "idle", true)).toBe(false));
  it("streaming never settles", () =>
    expect(s(it0({ streamedSincePrompt: true, idleSince: NOW - 99_000 }), "streaming")).toBe(false));
});
