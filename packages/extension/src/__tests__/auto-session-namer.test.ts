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
  type PersistedNamerState,
  sanitizeSessionName,
  type StreamSimpleFn,
  shouldSkipByPrefilter,
  TITLE_MAX_TOKENS_BASE,
  TITLE_MAX_TOKENS_ESCALATED,
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
    expect(parseTitle("Auth Token Refactor")).toEqual({ verdict: "title", title: "Auth Token Refactor" });
  });
  it("trims surrounding whitespace", () => {
    expect(parseTitle("  Auth Token Refactor  ")).toEqual({ verdict: "title", title: "Auth Token Refactor" });
  });
  it("waits on the NULL sentinel (any case)", () => {
    expect(parseTitle("NULL").verdict).toBe("waiting");
    expect(parseTitle("null").verdict).toBe("waiting");
  });
  it("waits on an over-long title", () => {
    expect(parseTitle("This Title Is Far Too Long To Be A Reasonable Session Name Indeed").verdict).toBe("waiting");
  });
  it("waits on too many words", () => {
    expect(parseTitle("One Two Three Four Five Six Seven").verdict).toBe("waiting");
  });

  // E4: with real headroom a truncated stream carries a PLAUSIBLE fragment that
  // passes both shape guards. Keying on emptiness would apply it as a permanent
  // session name; keying on the stop reason rejects it before parsing.
  it("E4: a `length` stop is starved and its text is never a title", () => {
    const v = parseTitle("Working On", "length");
    expect(v.verdict).toBe("starved");
    expect(v).not.toHaveProperty("title");
  });

  // E5: a toolUse stop is likewise not a title.
  it("E5: a `toolUse` stop is starved and its text is never a title", () => {
    const v = parseTitle("Bridge Fix", "toolUse");
    expect(v.verdict).toBe("starved");
    expect(v).not.toHaveProperty("title");
  });

  // E6: empty is NOT the NULL sentinel. Conflating them is the original bug:
  // it made a structurally impossible configuration indistinguishable from
  // "no clear topic yet", so the namer retried forever and reported nothing.
  it("E6: empty on an untruncated stream is starved, never waiting", () => {
    expect(parseTitle("", "stop").verdict).toBe("starved");
    expect(parseTitle("   ", "stop").verdict).toBe("starved");
    expect(parseTitle(undefined, "stop").verdict).toBe("starved");
  });

  // E7: the NULL sentinel stays benign — a well-behaved model saying "not yet".
  it("E7: the NULL sentinel is waiting, not starved", () => {
    expect(parseTitle("NULL", "stop")).toEqual({ verdict: "waiting", reason: expect.any(String) });
  });

  // E8: the 40-char guard is load-bearing and becomes MORE so with headroom.
  it("E8: title character boundary at 40", () => {
    expect(parseTitle("a".repeat(39), "stop").verdict).toBe("title");
    expect(parseTitle("a".repeat(40), "stop").verdict).toBe("title");
    expect(parseTitle("a".repeat(41), "stop").verdict).toBe("waiting");
  });

  // E9: the 6-word guard, same reasoning.
  it("E9: title word boundary at 6", () => {
    expect(parseTitle("One Two Three Four Five", "stop").verdict).toBe("title");
    expect(parseTitle("One Two Three Four Five Six", "stop").verdict).toBe("title");
    expect(parseTitle("One Two Three Four Five Six Seven", "stop").verdict).toBe("waiting");
  });

  // E10: observed in the wild — a model ignoring the summarizer prompt and
  // replying with 900 characters of chat. Rejected, and the rejection is
  // reported rather than swallowed.
  it("E10: an uncooperative 900-char prose reply is waiting with a reason", () => {
    const v = parseTitle("x".repeat(900), "stop");
    expect(v.verdict).toBe("waiting");
    expect((v as { reason: string }).reason).toMatch(/900/);
  });
});

describe("buildTranscriptWindow", () => {
  it("joins user + assistant", () => {
    expect(buildTranscriptWindow("do the thing", "sure, done")).toBe("do the thing\n\nsure, done");
  });
  it("omits the separator when there is no assistant reply", () => {
    expect(buildTranscriptWindow("do the thing", undefined)).toBe("do the thing");
  });
  // E19: advancing the window changes WHICH turn is sent, never HOW MUCH. An
  // earlier draft wrote "2000 each", which would have widened the user slice
  // tenfold — a security regression disguised as a formatting detail.
  it("E19: bounds the window at 200 chars of user + 2000 of assistant", () => {
    const huge = "x".repeat(5_000);
    const out = buildTranscriptWindow(huge, huge);
    const [user, assistant] = out.split("\n\n");
    expect(user).toHaveLength(200);
    expect(assistant).toHaveLength(2000);
    expect(out.split("\n\n")).toHaveLength(2); // exactly two slices leave the process
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
    expect(res).toEqual({ ok: true, text: "Auth Refactor", stopReason: "stop" });
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
    expect(res).toEqual({ ok: true, text: "Cold Start", stopReason: "stop" });
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
    resolveNamingModel: () => ({ literal: "anthropic/claude-haiku", slot: "naming" }),
    getRegistry: () => okRegistry,
    loadStreamSimple: async () => fakeStream([{ type: "text_delta", delta: "Auth Refactor" }, { type: "done", reason: "stop", message: { content: [] } }]),
    getTranscript: () => ({ userMsg: "Refactor the auth middleware for tokens", assistantReply: "on it" }),
    applyName: vi.fn(),
    reportUserRename: vi.fn(),
    emitError: vi.fn(),
    reportOutcome: vi.fn(),
    persistState: vi.fn(),
    ...overrides,
  };
}

/** A stream ending truncated with no usable text — the measured failure. */
function starvedStream(): StreamSimpleFn {
  return fakeStream([{ type: "done", reason: "length", message: { content: [] } }]);
}

/** A well-behaved model reporting "no nameable topic yet". */
function nullStream(): StreamSimpleFn {
  return fakeStream([{ type: "text_delta", delta: "NULL" }, { type: "done", reason: "stop", message: { content: [] } }]);
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
    const hooks = makeHooks({ getTranscript: () => ({ userMsg: "hi", assistantReply: "hello" }), loadStreamSimple });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(loadStreamSimple).not.toHaveBeenCalled();
    expect(hooks.applyName).not.toHaveBeenCalled();
  });

  it("emits one auto_name_error and hard-stops when no naming role is configured", async () => {
    const hooks = makeHooks({ resolveNamingModel: () => ({ reason: "role 'naming' unset; role 'fast' unset" }) });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    await namer.maybeName(); // must not emit twice
    expect(hooks.emitError).toHaveBeenCalledTimes(1);
    expect(hooks.applyName).not.toHaveBeenCalled();
    expect(namer._state().hardStopped).toBe(true);
  });

  it("waits (no name) when the model returns NULL", async () => {
    const hooks = makeHooks({ loadStreamSimple: async () => nullStream() });
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
        fakeStream([{ type: "text_delta", delta: "Foo\nBar" }, { type: "done", reason: "stop", message: { content: [] } }]),
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

/**
 * pi 0.84.0 BREAKING: `ModelRegistry.getApiKeyAndHeaders()` returns
 * `ProviderHeaders` with `string | null` values, preserving null header-deletion
 * markers. The markers exist so placeholder OpenAI credentials are not sent
 * through Cloudflare AI Gateway — coercing or dropping them re-opens that hole.
 *
 * Two distinct concerns: FORWARDING nulls to pi-ai unchanged (correctness), and
 * COUNTING them as absent in the usable-credentials gate (see design D4).
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #E9, #E10, #E11).
 */
describe("generateTitle — null-bearing provider headers (pi 0.84.x)", () => {
  function captureOptions() {
    const seen: any[] = [];
    const streamSimple: StreamSimpleFn = (_m, _c, options) => {
      seen.push(options);
      return (async function* () {
        yield { type: "done", message: { content: [{ type: "text", text: "T" }] } };
      })();
    };
    return { seen, streamSimple };
  }

  it("E9: a null deletion marker reaches pi-ai as null, never the string 'null'", async () => {
    const { seen, streamSimple } = captureOptions();
    const res = await generateTitle({
      registry: {
        find: () => ({ provider: "openai", id: "gpt" }),
        getApiKeyAndHeaders: async () =>
          ({ apiKey: "sk-test", headers: { "x-del": null, "x-keep": "v" } }),
      },
      streamSimple,
      modelRef: "openai/gpt",
      transcript: "x",
    });

    expect(res).toEqual({ ok: true, text: "T", stopReason: "stop" });
    expect(seen).toHaveLength(1);
    const headers = seen[0].headers;
    expect(headers).toHaveProperty("x-del");
    expect(headers["x-del"]).toBeNull();
    expect(headers["x-del"]).not.toBe("null");
    expect(headers["x-keep"]).toBe("v");
  });

  it("E10: a null-only header map counts as NO usable credentials", async () => {
    // Key count is 2, usable count is 0 — the old
    // `Object.keys(headers).length > 0` gate wrongly passed here.
    const { streamSimple } = captureOptions();
    const res = await generateTitle({
      registry: {
        find: () => ({ provider: "openai", id: "gpt" }),
        getApiKeyAndHeaders: async () =>
          ({ headers: { a: null, b: null } }),
      },
      streamSimple,
      modelRef: "openai/gpt",
      transcript: "x",
    });

    expect(res.ok).toBe(false);
    expect((res as { hardError: boolean }).hardError).toBe(true);
    expect((res as { reason: string }).reason).toMatch(/no usable credentials/i);
  });

  it("E11: a mixed header map counts as usable credentials", async () => {
    const { seen, streamSimple } = captureOptions();
    const res = await generateTitle({
      registry: {
        find: () => ({ provider: "openai", id: "gpt" }),
        getApiKeyAndHeaders: async () =>
          ({ headers: { a: null, b: "v" } }),
      },
      streamSimple,
      modelRef: "openai/gpt",
      transcript: "x",
    });

    expect(res).toEqual({ ok: true, text: "T", stopReason: "stop" });
    expect(seen[0].headers).toEqual({ a: null, b: "v" });
  });
});

/**
 * The adaptive output cap (design D3). Measured on the configured model with
 * this exact prompt: 16/64/256/512 all ended `length` with no text; 1024
 * returned `NULL`; 2048 returned a title after 724 reasoning tokens. The cap is
 * a CEILING, not a charge, so escalating costs nothing on the common path.
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #E1, #E2, #E3).
 */
describe("createAutoNamer — adaptive output cap", () => {
  function capturingHooks(streamEvents: any[], overrides: any = {}) {
    const seen: any[] = [];
    const streamSimple: StreamSimpleFn = (_m, _c, options) => {
      seen.push(options);
      return (async function* () {
        for (const e of streamEvents) yield e;
      })();
    };
    return { seen, hooks: makeHooks({ loadStreamSimple: async () => streamSimple, ...overrides }) };
  }

  it("E1: a session's FIRST attempt requests the 1024-token base cap", async () => {
    const { seen, hooks } = capturingHooks([{ type: "done", reason: "stop", message: { content: [] } }]);
    await createAutoNamer(hooks).maybeName();
    expect(seen).toHaveLength(1);
    expect(seen[0].maxTokens).toBe(TITLE_MAX_TOKENS_BASE);
    expect(TITLE_MAX_TOKENS_BASE).toBe(1024);
    // D2: reasoning suppression is not expressible on this options surface, and
    // an unsupported level can be clamped UP — re-starving the budget.
    expect(seen[0]).not.toHaveProperty("reasoning");
  });

  it("E2: a recorded `starved` verdict escalates the next attempt to 2048", async () => {
    const { seen, hooks } = capturingHooks([{ type: "done", reason: "length", message: { content: [] } }]);
    const namer = createAutoNamer(hooks);
    await namer.maybeName(); // starves
    await namer.maybeName();
    expect(seen[0].maxTokens).toBe(TITLE_MAX_TOKENS_BASE);
    expect(seen[1].maxTokens).toBe(TITLE_MAX_TOKENS_ESCALATED);
    expect(TITLE_MAX_TOKENS_ESCALATED).toBe(2048);
  });

  it("E3: a `waiting` verdict on an untruncated stream does NOT escalate", async () => {
    const { seen, hooks } = capturingHooks([
      { type: "text_delta", delta: "NULL" },
      { type: "done", reason: "stop", message: { content: [] } },
    ]);
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    await namer.maybeName();
    expect(seen[0].maxTokens).toBe(TITLE_MAX_TOKENS_BASE);
    expect(seen[1].maxTokens).toBe(TITLE_MAX_TOKENS_BASE);
  });
});

/**
 * ONE bounded attempt budget shared by `starved` and `waiting` (design D5).
 * Starvation is nondeterministic, so one starved attempt must not stop a
 * session; equally `waiting` cannot retry forever against a 2048-token ceiling,
 * which would turn a claimed cost improvement into an unbounded regression.
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #E11–#E17, #P1, #P2).
 */
describe("createAutoNamer — attempt budget", () => {
  const starvedState = (attemptsUsed: number) => ({
    hardStopped: false, errorEmitted: false, attemptsUsed,
    starvedCount: attemptsUsed, waitingCount: 0, sawStarved: attemptsUsed > 0,
    hasAutoName: false,
  });

  it("E11: reaching the bound stops permanently and emits exactly one error", async () => {
    const hooks = makeHooks({ loadStreamSimple: async () => starvedStream() });
    const namer = createAutoNamer(hooks, starvedState(2));
    await namer.maybeName();
    expect(namer._state()).toMatchObject({ hardStopped: true, attemptsUsed: 3 });
    expect(hooks.emitError).toHaveBeenCalledTimes(1);

    await namer.maybeName(); // a later turn must not re-emit
    expect(hooks.emitError).toHaveBeenCalledTimes(1);
    expect(hooks.applyName).not.toHaveBeenCalled();
  });

  it("E12: below the bound does NOT stop — starvation is nondeterministic", async () => {
    const hooks = makeHooks({ loadStreamSimple: async () => starvedStream() });
    const namer = createAutoNamer(hooks, starvedState(1));
    await namer.maybeName();
    expect(namer._state()).toMatchObject({ hardStopped: false, attemptsUsed: 2 });
    expect(hooks.emitError).not.toHaveBeenCalled();
  });

  it("E13: three `waiting` verdicts alone exhaust the same budget", async () => {
    const hooks = makeHooks({ loadStreamSimple: async () => nullStream() });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    await namer.maybeName();
    await namer.maybeName();
    expect(namer._state()).toMatchObject({ hardStopped: true, attemptsUsed: 3 });
    expect(hooks.emitError).toHaveBeenCalledTimes(1);
  });

  it("E14: transient errors spend NOTHING and never emit an error", async () => {
    const hooks = makeHooks({
      loadStreamSimple: async () => fakeStream([{ type: "error", error: { message: "rate limited" } }]),
    });
    const namer = createAutoNamer(hooks);
    for (let i = 0; i < 5; i++) await namer.maybeName();
    expect(namer._state()).toMatchObject({ attemptsUsed: 0, hardStopped: false });
    expect(hooks.emitError).not.toHaveBeenCalled();
  });

  it("E15: a starved-dominant exhaustion tells the operator to change the model", async () => {
    const hooks = makeHooks({ loadStreamSimple: async () => starvedStream() });
    await createAutoNamer(hooks, starvedState(2)).maybeName();
    const reason = (hooks.emitError as any).mock.calls[0][0] as string;
    expect(reason).toMatch(/naming role/i);
    expect(reason).toMatch(/anthropic\/claude-haiku/);
    expect(reason).toMatch(/@naming/);
  });

  it("E16: a waiting-dominant exhaustion does NOT blame the model", async () => {
    const hooks = makeHooks({ loadStreamSimple: async () => nullStream() });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    await namer.maybeName();
    await namer.maybeName();
    const reason = (hooks.emitError as any).mock.calls[0][0] as string;
    expect(reason).toMatch(/no nameable topic/i);
    expect(reason).not.toMatch(/Assign a different model/i);
  });

  it("E17: on a tie the starved remedy wins — the more actionable one", async () => {
    // 2 starved + 2 waiting, with the budget raised so the tie is reachable.
    const hooks = makeHooks({ attemptBudget: 4, loadStreamSimple: async () => starvedStream() });
    const namer = createAutoNamer(hooks, {
      hardStopped: false, errorEmitted: false, attemptsUsed: 3,
      starvedCount: 1, waitingCount: 2, sawStarved: true, hasAutoName: false,
    });
    await namer.maybeName(); // → 2 starved vs 2 waiting
    const reason = (hooks.emitError as any).mock.calls[0][0] as string;
    expect(reason).toMatch(/Assign a different model/i);
  });

  it("P1: per-session model cost is bounded by the budget, not by turn count", async () => {
    let calls = 0;
    const streamSimple: StreamSimpleFn = () => {
      calls++;
      return (async function* () { yield { type: "done", reason: "length", message: { content: [] } }; })();
    };
    const namer = createAutoNamer(makeHooks({ loadStreamSimple: async () => streamSimple }));
    for (let i = 0; i < 50; i++) await namer.maybeName();
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("P2: cost does not grow between a 50-turn and a 500-turn session", async () => {
    async function run(turns: number): Promise<number> {
      let calls = 0;
      const streamSimple: StreamSimpleFn = () => {
        calls++;
        return (async function* () { yield { type: "done", reason: "length", message: { content: [] } }; })();
      };
      const namer = createAutoNamer(makeHooks({ loadStreamSimple: async () => streamSimple }));
      for (let i = 0; i < turns; i++) await namer.maybeName();
      return calls;
    }
    expect(await run(50)).toBe(await run(500));
  });
});

/**
 * In-flight safety (design D8). Both defects are pre-existing, but the budget
 * accounting makes them worse: correctness now depends on "one attempt = one
 * spend", and on a completion never overwriting a user's chosen name.
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #X6, #X7).
 */
describe("createAutoNamer — in-flight safety", () => {
  it("X6: a rename landing mid-call is not clobbered by the completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const hooks = makeHooks({
      loadStreamSimple: async () => (() => (async function* () {
        await gate;
        yield { type: "text_delta", delta: "Auth Refactor" };
        yield { type: "done", reason: "stop", message: { content: [] } };
      })()) as StreamSimpleFn,
    });
    const namer = createAutoNamer(hooks);
    const attempt = namer.maybeName();
    namer.onObservedName("Hand Typed Name"); // external rename lands mid-stream
    release();
    await attempt;

    expect(hooks.applyName).not.toHaveBeenCalled();
    expect(namer._state().nameSource).toBe("user");
    expect(hooks.reportUserRename).toHaveBeenCalledWith("Hand Typed Name");
  });

  it("X7: two adjacent terminal turns start exactly one call and spend one unit", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const streamSimple: StreamSimpleFn = () => {
      calls++;
      return (async function* () {
        await gate;
        yield { type: "done", reason: "length", message: { content: [] } };
      })();
    };
    const namer = createAutoNamer(makeHooks({ loadStreamSimple: async () => streamSimple }));
    const a = namer.maybeName();
    const b = namer.maybeName(); // arrives before the first call resolves
    release();
    await Promise.all([a, b]);

    expect(calls).toBe(1);
    expect(namer._state().attemptsUsed).toBe(1);
  });
});

/**
 * The durable stop and its clearing rule (design D7). Clearing by RE-RESOLUTION
 * rather than by a roles event is load-bearing: a role write is routed to one
 * session's bridge, so a listener would clear the stop only there and strand
 * every other stopped session forever.
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #X9–#X16).
 */
describe("createAutoNamer — durable stop", () => {
  const stopped = (over: Partial<PersistedNamerState> = {}): PersistedNamerState => ({
    hardStopped: true, errorEmitted: true, attemptsUsed: 3,
    starvedCount: 3, waitingCount: 0, sawStarved: true,
    stoppedModelRef: "anthropic/claude-haiku", stopCause: "budget",
    hasAutoName: false, ...over,
  });

  it("X9: a stop survives reload — no further attempt, no second error", async () => {
    const loadStreamSimple = vi.fn(async () => starvedStream());
    const hooks = makeHooks({ loadStreamSimple });
    const namer = createAutoNamer(hooks, stopped());
    await namer.maybeName();
    expect(loadStreamSimple).not.toHaveBeenCalled();
    expect(hooks.emitError).not.toHaveBeenCalled();
  });

  it("X10: the spent budget survives reload and does not reset to zero", async () => {
    const carried = createAutoNamer(makeHooks(), stopped({ hardStopped: false, errorEmitted: false, attemptsUsed: 2, starvedCount: 2 }));
    expect(carried._state().attemptsUsed).toBe(2);
    expect(carried.exportState().attemptsUsed).toBe(2);
  });

  it("X13: reassigning a model that resolves to the SAME ref does not clear", async () => {
    const hooks = makeHooks({ resolveNamingModel: () => ({ literal: "anthropic/claude-haiku", slot: "naming" }) });
    const namer = createAutoNamer(hooks, stopped());
    await namer.maybeName();
    expect(namer._state().hardStopped).toBe(true);
    expect(hooks.applyName).not.toHaveBeenCalled();
  });

  it("X14: clearing resets the budget AND re-arms the error", async () => {
    // Without BOTH resets the operator's remedy is vacuous: one retry, an
    // instant re-exhaustion of the already-spent budget, and no error at all
    // because the one-shot flag is still latched.
    const hooks = makeHooks({
      resolveNamingModel: () => ({ literal: "openai/gpt-other", slot: "naming" }),
      loadStreamSimple: async () => starvedStream(),
    });
    const namer = createAutoNamer(hooks, stopped());

    await namer.maybeName();
    expect(namer._state()).toMatchObject({ hardStopped: false, attemptsUsed: 1 });

    await namer.maybeName();
    await namer.maybeName();
    expect(namer._state()).toMatchObject({ hardStopped: true, attemptsUsed: 3 });
    expect(hooks.emitError).toHaveBeenCalledTimes(1); // a NEW error, re-armed
  });

  it("X15: a credential fix clears the stop with the reference unchanged", async () => {
    let credentialsWork = false;
    const registry: NamerRegistry = {
      find: () => ({ provider: "anthropic", id: "claude-haiku" }),
      getApiKeyAndHeaders: async () => {
        if (!credentialsWork) throw new Error("no credentials");
        return { apiKey: "sk-now-configured" };
      },
    };
    const hooks = makeHooks({ getRegistry: () => registry });
    const namer = createAutoNamer(hooks, stopped({ stopCause: "credentials" }));

    await namer.maybeName();
    expect(namer._state().hardStopped).toBe(true); // still broken

    credentialsWork = true;
    await namer.maybeName();
    expect(namer._state().hardStopped).toBe(false);
  });

  it("X16: clearing never overrides a `user` lockout", async () => {
    const hooks = makeHooks({ resolveNamingModel: () => ({ literal: "openai/gpt-other", slot: "naming" }) });
    const namer = createAutoNamer(hooks, stopped({ nameSource: "user" }));
    await namer.maybeName();
    expect(namer._state()).toMatchObject({ hardStopped: true, nameSource: "user" });
    expect(hooks.applyName).not.toHaveBeenCalled();
  });
});

/**
 * The advancing transcript window and the pre-filter that reads it (design D6).
 * The frozen window made every retry byte-identical and skipped a session that
 * opened with a greeting for life.
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #E20, #E21).
 */
describe("createAutoNamer — advancing window pre-filter", () => {
  it("E20: a trivial LATEST message does not mask a substantive session", async () => {
    // The window selects the latest SUBSTANTIVE user entry, so a trailing "ok"
    // does not send an otherwise-nameable session back to the skip path.
    const hooks = makeHooks({
      getTranscript: () => ({ userMsg: "Refactor the auth middleware for tokens", assistantReply: "on it" }),
    });
    await createAutoNamer(hooks).maybeName();
    expect(hooks.applyName).toHaveBeenCalledWith("Auth Refactor");
  });

  it("E21: a genuine greeting is still skipped with no model call", async () => {
    const loadStreamSimple = vi.fn(async () => fakeStream([]));
    const hooks = makeHooks({ getTranscript: () => ({ userMsg: "hi" }), loadStreamSimple });
    await createAutoNamer(hooks).maybeName();
    expect(loadStreamSimple).not.toHaveBeenCalled();
    expect(hooks.reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "skipped-prefilter" }),
    );
  });
});

/**
 * Complete, deduplicated outcome reporting (design D9). Today every one of
 * these paths returns silently, which is why a system with zero successes AND
 * zero errors was structurally invisible.
 *
 * See change: fix-auto-naming-reasoning-model (test-plan #X3–#X5, #X8, #E33, #E34, #P3).
 */
describe("createAutoNamer — outcome reporting", () => {
  const outcomesOf = (hooks: any) =>
    (hooks.reportOutcome as any).mock.calls.map((c: any[]) => c[0].outcome);

  it("X8: dependencies not ready reports `not-ready` and spends no budget", async () => {
    const hooks = makeHooks({ getRegistry: () => undefined });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(outcomesOf(hooks)).toContain("not-ready");
    expect(namer._state().attemptsUsed).toBe(0);
    expect(hooks.emitError).not.toHaveBeenCalled();
  });

  it("X3: a transient network error reports `retrying`, never `waiting`", async () => {
    const hooks = makeHooks({
      loadStreamSimple: async () => (() => { throw new Error("socket hang up"); }) as StreamSimpleFn,
    });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(outcomesOf(hooks)).toContain("retrying");
    expect(outcomesOf(hooks)).not.toContain("waiting");
    expect(namer._state().attemptsUsed).toBe(0);
  });

  it("X4: a user abort is a soft error, not starvation", async () => {
    const hooks = makeHooks({
      loadStreamSimple: async () => fakeStream([{ type: "error", reason: "aborted", error: { message: "aborted" } }]),
    });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    expect(outcomesOf(hooks)).toContain("retrying");
    expect(outcomesOf(hooks)).not.toContain("starved");
    expect(namer._state().attemptsUsed).toBe(0);
  });

  it("X5: the soft-error reason is read from the event's message payload", async () => {
    const hooks = makeHooks({
      loadStreamSimple: async () => fakeStream([{ type: "error", error: { message: "upstream 529" } }]),
    });
    await createAutoNamer(hooks).maybeName();
    expect(hooks.reportOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "retrying", reason: "upstream 529" }),
    );
  });

  it("E33: an unchanged outcome is not resent on later turns", async () => {
    const hooks = makeHooks();
    const namer = createAutoNamer(hooks);
    await namer.maybeName();                       // applied
    (hooks.reportOutcome as any).mockClear();
    for (let i = 0; i < 4; i++) await namer.maybeName(); // already-named ×4
    expect((hooks.reportOutcome as any).mock.calls).toHaveLength(1);
  });

  it("E34: a CHANGED outcome is sent", async () => {
    let starve = false;
    const hooks = makeHooks({
      loadStreamSimple: async () => (starve ? starvedStream() : nullStream()),
    });
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    starve = true;
    await namer.maybeName();
    expect(outcomesOf(hooks)).toEqual(["waiting", "starved"]);
  });

  it("P3: dedupe bounds the wire cost of a terminal state over 100 turns", async () => {
    const hooks = makeHooks();
    const namer = createAutoNamer(hooks);
    await namer.maybeName();
    (hooks.reportOutcome as any).mockClear();
    for (let i = 0; i < 100; i++) await namer.maybeName();
    expect((hooks.reportOutcome as any).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("the `disabled` outcome is reachable — the toggle lives inside the namer", async () => {
    const hooks = makeHooks({ getAutoNameSessions: () => false });
    await createAutoNamer(hooks).maybeName();
    expect(outcomesOf(hooks)).toEqual(["disabled"]);
  });
});
