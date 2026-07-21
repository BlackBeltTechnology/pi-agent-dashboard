/**
 * Automatic session topic-naming: pure helpers + the state-machine factory.
 *
 * Covers the eligibility gate, pre-filter skip cases, `@fast` resolution
 * (hard-error branch), the transcript-window bound, title parsing
 * (valid / NULL / empty / too-long), the in-process model call (fake registry
 * + fake streamSimple), the OAuth-only hard-error, and the provenance state
 * machine (auto → external change → user; one-shot error).
 *
 * See change: add-auto-session-naming.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildTranscriptWindow,
  classifyNameChange,
  createAutoNamer,
  generateTitle,
  isEligible,
  type NamerRegistry,
  parseTitle,
  sanitizeSessionName,
  type StreamSimpleFn,
  shouldSkipByPrefilter,
} from "../auto-session-namer.js";

describe("shouldSkipByPrefilter", () => {
  it.each([
    ["hi"],
    ["hello"],
    ["thanks"],
    ["ok"],
    ["test"],
    ["  hey  "],
    ["/commit"],
    ["/status"],
    ["short"], // < 15 chars
  ])("skips %j without a model call", (msg) => {
    expect(shouldSkipByPrefilter(msg)).toBe(true);
  });

  it("passes a substantive first message", () => {
    expect(shouldSkipByPrefilter("Refactor the auth middleware to support tokens")).toBe(false);
  });

  it("skips undefined / empty", () => {
    expect(shouldSkipByPrefilter(undefined)).toBe(true);
    expect(shouldSkipByPrefilter("")).toBe(true);
  });
});

describe("parseTitle", () => {
  it("accepts a valid title", () => {
    expect(parseTitle("Auth Token Refactor")).toEqual({ title: "Auth Token Refactor", wait: false });
  });
  it("trims surrounding whitespace", () => {
    expect(parseTitle("  Auth Token Refactor  ")).toEqual({ title: "Auth Token Refactor", wait: false });
  });
  it("waits on the NULL sentinel (any case)", () => {
    expect(parseTitle("NULL").wait).toBe(true);
    expect(parseTitle("null").wait).toBe(true);
  });
  it("waits on empty", () => {
    expect(parseTitle("").wait).toBe(true);
    expect(parseTitle("   ").wait).toBe(true);
    expect(parseTitle(undefined).wait).toBe(true);
  });
  it("waits on an over-long title", () => {
    expect(parseTitle("This Title Is Far Too Long To Be A Reasonable Session Name Indeed").wait).toBe(true);
  });
  it("waits on too many words", () => {
    expect(parseTitle("One Two Three Four Five Six Seven").wait).toBe(true);
  });
});

describe("buildTranscriptWindow", () => {
  it("joins user + assistant", () => {
    expect(buildTranscriptWindow("do the thing", "sure, done")).toBe("do the thing\n\nsure, done");
  });
  it("omits the separator when there is no assistant reply", () => {
    expect(buildTranscriptWindow("do the thing", undefined)).toBe("do the thing");
  });
  it("bounds the window size", () => {
    const huge = "x".repeat(10_000);
    const out = buildTranscriptWindow(huge, huge);
    // each side capped at 2000 + the 2-char separator
    expect(out.length).toBeLessThanOrEqual(2000 + 2 + 2000);
  });
});

describe("isEligible", () => {
  it("true only when enabled, not user-named, and no auto-name yet", () => {
    expect(isEligible({ autoNameSessions: true, nameSource: undefined, hasAutoName: false })).toBe(true);
  });
  it("false when disabled", () => {
    expect(isEligible({ autoNameSessions: false, nameSource: undefined, hasAutoName: false })).toBe(false);
  });
  it("false when user-named", () => {
    expect(isEligible({ autoNameSessions: true, nameSource: "user", hasAutoName: false })).toBe(false);
  });
  it("false when already auto-named", () => {
    expect(isEligible({ autoNameSessions: true, nameSource: "auto", hasAutoName: true })).toBe(false);
  });
});

describe("classifyNameChange", () => {
  it("self when equal to the last self-applied title", () => {
    expect(classifyNameChange("Auth Refactor", "Auth Refactor")).toBe("self");
  });
  it("external when different or never self-applied", () => {
    expect(classifyNameChange("Hand Typed", "Auth Refactor")).toBe("external");
    expect(classifyNameChange("Hand Typed", undefined)).toBe("external");
  });
  // F5: a self-applied title with an internal newline still matches the
  // newline-collapsed name pi carries in session_info_changed.
  it("F5: self when a newline-bearing self-title matches the sanitized event name", () => {
    expect(classifyNameChange("Foo Bar", "Foo\nBar")).toBe("self");
    expect(classifyNameChange("Foo Bar", "Foo\r\nBar")).toBe("self");
    expect(classifyNameChange("  Foo Bar  ", "Foo\nBar")).toBe("self");
  });
  // F4: a genuine external rename is still external.
  it("F4: external for a hand-typed rename that is not the self title", () => {
    expect(classifyNameChange("Bar", "Foo")).toBe("external");
  });
});

describe("sanitizeSessionName", () => {
  it("collapses internal newlines to single spaces and trims", () => {
    expect(sanitizeSessionName("Foo\nBar")).toBe("Foo Bar");
    expect(sanitizeSessionName("Foo\r\n\nBar")).toBe("Foo Bar");
    expect(sanitizeSessionName("  Foo Bar  ")).toBe("Foo Bar");
  });
});

// ── generateTitle: in-process model call ─────────────────────────────────
function fakeStream(events: any[]): StreamSimpleFn {
  return () => (async function* () {
    for (const e of events) yield e;
  })();
}

const okRegistry: NamerRegistry = {
  find: () => ({ provider: "anthropic", id: "claude-haiku" }),
  getApiKeyAndHeaders: async () => ({ apiKey: "sk-test", headers: {} }),
};

describe("generateTitle", () => {
  it("concatenates text_delta events", async () => {
    const res = await generateTitle({
      registry: okRegistry,
      streamSimple: fakeStream([
        { type: "text_delta", delta: "Auth " },
        { type: "text_delta", delta: "Refactor" },
        { type: "done", message: { content: [] } },
      ]),
      modelRef: "anthropic/claude-haiku",
      transcript: "refactor auth",
    });
    expect(res).toEqual({ ok: true, text: "Auth Refactor" });
  });

  it("falls back to the final message when no deltas arrive", async () => {
    const res = await generateTitle({
      registry: okRegistry,
      streamSimple: fakeStream([
        { type: "done", message: { content: [{ type: "text", text: "Cold Start" }] } },
      ]),
      modelRef: "anthropic/claude-haiku",
      transcript: "x",
    });
    expect(res).toEqual({ ok: true, text: "Cold Start" });
  });

  it("hard-errors on an unknown model (not a throw)", async () => {
    const res = await generateTitle({
      registry: { find: () => undefined, getApiKeyAndHeaders: async () => ({ apiKey: "k" }) },
      streamSimple: fakeStream([]),
      modelRef: "nope/missing",
      transcript: "x",
    });
    expect(res).toEqual({ ok: false, hardError: true, reason: expect.stringContaining("not found") });
  });

  it("hard-errors when credential resolution throws (OAuth-only, unauthable)", async () => {
    const res = await generateTitle({
      registry: {
        find: () => ({}),
        getApiKeyAndHeaders: async () => {
          throw new Error("oauth required");
        },
      },
      streamSimple: fakeStream([]),
      modelRef: "anthropic/claude-oauth",
      transcript: "x",
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ hardError: true });
  });

  it("hard-errors when no usable credentials are returned", async () => {
    const res = await generateTitle({
      registry: { find: () => ({}), getApiKeyAndHeaders: async () => ({}) },
      streamSimple: fakeStream([]),
      modelRef: "anthropic/claude-oauth",
      transcript: "x",
    });
    expect(res).toMatchObject({ ok: false, hardError: true });
  });

  it("soft-errors (retry) on a stream error event", async () => {
    const res = await generateTitle({
      registry: okRegistry,
      streamSimple: fakeStream([{ type: "error", errorMessage: "rate limited" }]),
      modelRef: "anthropic/claude-haiku",
      transcript: "x",
    });
    expect(res).toMatchObject({ ok: false, hardError: false, reason: "rate limited" });
  });

  it("soft-errors (retry) when streamSimple throws", async () => {
    const res = await generateTitle({
      registry: okRegistry,
      streamSimple: () => {
        throw new Error("socket hang up");
      },
      modelRef: "anthropic/claude-haiku",
      transcript: "x",
    });
    expect(res).toMatchObject({ ok: false, hardError: false });
  });
});

// ── createAutoNamer: state machine ───────────────────────────────────────
function makeHooks(overrides: Partial<Parameters<typeof createAutoNamer>[0]> = {}) {
  return {
    getAutoNameSessions: () => true,
    resolveFastModel: () => ({ literal: "anthropic/claude-haiku" }),
    getRegistry: () => okRegistry,
    loadStreamSimple: async () => fakeStream([{ type: "text_delta", delta: "Auth Refactor" }, { type: "done", message: { content: [] } }]),
    getTranscript: () => ({ firstUserMsg: "Refactor the auth middleware for tokens", firstAssistantReply: "on it" }),
    applyName: vi.fn(),
    reportUserRename: vi.fn(),
    emitError: vi.fn(),
    ...overrides,
  };
}

describe("createAutoNamer", () => {
  it("names an eligible session once, then stops", async () => {
    const hooks = makeHooks();
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(hooks.applyName).toHaveBeenCalledWith("Auth Refactor");
    expect(namer._state()).toMatchObject({ hasAutoName: true, nameSource: "auto" });

    // A second terminal turn must NOT attempt again.
    (hooks.applyName as any).mockClear();
    await namer.maybeName();
    expect(hooks.applyName).not.toHaveBeenCalled();
  });

  it("does nothing when the feature is disabled", async () => {
    const hooks = makeHooks({ getAutoNameSessions: () => false });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(hooks.applyName).not.toHaveBeenCalled();
  });

  it("skips the model call on a greeting-only opener", async () => {
    const loadStreamSimple = vi.fn(async () => fakeStream([]));
    const hooks = makeHooks({ getTranscript: () => ({ firstUserMsg: "hi", firstAssistantReply: "hello" }), loadStreamSimple });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(loadStreamSimple).not.toHaveBeenCalled();
    expect(hooks.applyName).not.toHaveBeenCalled();
  });

  it("emits one auto_name_error and hard-stops when @fast is unconfigured", async () => {
    const hooks = makeHooks({ resolveFastModel: () => ({ reason: "role 'fast' not configured yet" }) });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    await namer.maybeName(); // must not emit twice
    expect(hooks.emitError).toHaveBeenCalledTimes(1);
    expect(hooks.applyName).not.toHaveBeenCalled();
    expect(namer._state().hardStopped).toBe(true);
  });

  it("waits (no name) when the model returns NULL", async () => {
    const hooks = makeHooks({
      loadStreamSimple: async () => fakeStream([{ type: "text_delta", delta: "NULL" }, { type: "done", message: { content: [] } }]),
    });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(hooks.applyName).not.toHaveBeenCalled();
    expect(namer._state()).toMatchObject({ hasAutoName: false, hardStopped: false });
  });

  it("escalates auto → user on an external rename", async () => {
    const hooks = makeHooks();
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(namer._state().nameSource).toBe("auto");

    // The bridge observing its OWN applied name is a no-op.
    namer.onObservedName("Auth Refactor");
    expect(hooks.reportUserRename).not.toHaveBeenCalled();
    expect(namer._state().nameSource).toBe("auto");

    // A different observed name = external rename → permanent user lockout.
    namer.onObservedName("Hand Typed Name");
    expect(hooks.reportUserRename).toHaveBeenCalledWith("Hand Typed Name");
    expect(namer._state()).toMatchObject({ nameSource: "user", hardStopped: true });
  });

  it("F5: a newline-bearing self-name echoing back (sanitized) does NOT lock out", async () => {
    // The bridge self-applies "Foo\nBar"; pi sanitizes + broadcasts "Foo Bar"
    // via session_info_changed. The self-filter must classify it self.
    const hooks = makeHooks({
      loadStreamSimple: async () =>
        fakeStream([{ type: "text_delta", delta: "Foo\nBar" }, { type: "done", message: { content: [] } }]),
    });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(hooks.applyName).toHaveBeenCalledWith("Foo\nBar");
    expect(namer._state().nameSource).toBe("auto");

    // The sanitized echo comes back through session_info_changed → self, no push.
    namer.onObservedName("Foo Bar");
    expect(hooks.reportUserRename).not.toHaveBeenCalled();
    expect(namer._state()).toMatchObject({ nameSource: "auto", hardStopped: false });
  });

  it("seeds a user lockout restored from meta", async () => {
    const hooks = makeHooks();
    const namer = createAutoNamer(hooks);
    namer.seed("user");
    await namer.maybeName();
    expect(hooks.applyName).not.toHaveBeenCalled();
  });
});
