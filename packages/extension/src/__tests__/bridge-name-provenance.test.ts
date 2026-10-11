/**
 * Bridge wiring of session-name provenance (X1–X5). No test instantiates
 * `initBridge` (it opens sockets/timers at load), so this composes the REAL
 * `createCommandHandler` + `createAutoNamer` + `applyAutoNameRestore` exactly as
 * `bridge.ts` wires them, and pins the wiring in the bridge source.
 *
 * See change: investigate-auto-name-provenance-relabel.
 */
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type AutoNamer, applyAutoNameRestore, createAutoNamer, type PersistedNamerState } from "../auto-session-namer.js";
import { createCommandHandler } from "../command-handler.js";

const SRC = fs.readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");

/** Mirrors the bridge: a lazily-created namer, observations from session_info_changed. */
function makeBridge(opts: { restored?: PersistedNamerState; setSessionNameThrows?: boolean; echoInside?: boolean } = {}) {
  const sent: any[] = [];
  const persisted: PersistedNamerState[] = [];
  let piName: string | undefined;
  let namerState = opts.restored;
  let autoNamer: AutoNamer | undefined;
  let lastSessionName: string | undefined;

  const getAutoNamer = (): AutoNamer => {
    if (autoNamer) return autoNamer;
    autoNamer = createAutoNamer({
      getAutoNameSessions: () => true,
      resolveNamingModel: () => ({ literal: "anthropic/claude-haiku", slot: "naming" }),
      getRegistry: () => undefined,
      loadStreamSimple: async () => undefined,
      getTranscript: () => ({ userMsg: "", assistantReply: "" }),
      applyName: () => {},
      reportUserRename: (name: string) => sent.push({ type: "session_name_update", name, nameSource: "user" }),
      emitError: () => {},
      reportOutcome: () => {},
      persistState: (st: PersistedNamerState) => { namerState = st; persisted.push(st); },
    } as any, namerState);
    return autoNamer;
  };
  /** The bridge's session_info_changed branch. */
  const observe = (name: string) => { if (name) getAutoNamer().onObservedName(name); };

  const pi = {
    setSessionName: vi.fn((name: string) => {
      if (opts.setSessionNameThrows) throw new Error("boom");
      piName = name;
      if (opts.echoInside) observe(name);
    }),
    getSessionName: () => piName,
    getCommands: () => [], on: vi.fn(), exec: vi.fn(), sendMessage: vi.fn(), sendUserMessage: vi.fn(),
  };
  const handler = createCommandHandler(pi as any, "s1", {
    onSystemRename: (name: string) => {
      const prevName = lastSessionName;
      const rollbackNamer = getAutoNamer().noteSystemRename(name);
      lastSessionName = name;
      return () => { rollbackNamer(); lastSessionName = prevName; };
    },
    onUserRename: () => { autoNamer?.noteUserRename(); },
  } as any);
  return {
    sent, persisted, pi, handler, observe, getAutoNamer,
    setPiName: (n: string | undefined) => { piName = n; },
    restore: (msg: any) => {
      const adopted = applyAutoNameRestore(msg, autoNamer, pi.getSessionName());
      if (adopted) namerState = adopted;
    },
    peek: () => autoNamer,
    userClaims: () => sent.filter((m) => m.nameSource === "user"),
    namerState: () => namerState,
  };
}

const rename = (name: string, origin?: "system") => ({ type: "rename_session" as const, sessionId: "s1", name, ...(origin ? { origin } : {}) });

/**
 * @structural-pin bridge.ts cannot be instantiated in a test; the wiring of the real handlers into it is pinned in its text
 */
describe("bridge wiring is pinned in the source", () => {
  it("passes both rename hooks and routes the restore through applyAutoNameRestore", () => {
    expect(SRC).toContain("onSystemRename: (name: string) =>");
    expect(SRC).toContain("getAutoNamer().noteSystemRename(name)");
    expect(SRC).toContain("onUserRename: () =>");
    expect(SRC).toContain("applyAutoNameRestore(msg as any, autoNamer, pi.getSessionName())");
    expect(SRC).not.toContain("deliberately NOT restored");
  });
});

describe("X1: system rename rolls back when pi throws", () => {
  it("restores auto provenance and never latches user on the old name", async () => {
    const b = makeBridge({ setSessionNameThrows: true });
    const namer = b.getAutoNamer();
    // Put the namer into `auto` "T" via a witnessed restore.
    namer.restoreProvenance({ nameSource: "auto", nameSourceFor: "T" }, undefined);
    expect(namer._state().nameSource).toBe("auto");
    await expect(b.handler.handle(rename("add-x", "system"))).rejects.toThrow("boom");
    expect(namer._state().nameSource).toBe("auto");
    expect(namer.exportState().lastSystemApplied).toBeUndefined();
    expect(b.namerState()).toMatchObject({ nameSource: "auto", lastSelfApplied: "T" });
    expect(b.namerState()?.lastSystemApplied).toBeUndefined();
    b.observe("T");
    expect(b.userClaims()).toHaveLength(0);
  });
});

describe("X3: synchronous echo inside setSessionName", () => {
  it("a system rename whose echo fires inside pi.setSessionName sends no user claim", async () => {
    const b = makeBridge({ echoInside: true });
    await b.handler.handle(rename("add-x", "system"));
    expect(b.userClaims()).toHaveLength(0);
    expect(b.peek()!._state().nameSource).toBe("system");
  });
});

describe("X5: a rename without origin is external (today's behaviour)", () => {
  it("echo classifies external → user, no throw", async () => {
    const b = makeBridge({
      echoInside: true,
      restored: { hardStopped: false, errorEmitted: false, attemptsUsed: 0, starvedCount: 0, waitingCount: 0, sawStarved: false, hasAutoName: false },
    });
    await b.handler.handle(rename("add-x"));
    expect(b.userClaims()).toEqual([{ type: "session_name_update", name: "add-x", nameSource: "user" }]);
    expect(b.peek()!._state().nameSource).toBe("user");
  });
  it("a no-origin rename after a system rename clears the system witness first", async () => {
    const b = makeBridge({ echoInside: true });
    await b.handler.handle(rename("add-x", "system"));
    await b.handler.handle(rename("add-x"));
    expect(b.userClaims()).toHaveLength(1);
  });
});

describe("X2: restore arrives AFTER an observation and a turn-end", () => {
  it("namer ends auto, not stopped; next observation sends no user claim", () => {
    const b = makeBridge();
    b.setPiName("A");
    b.observe("A"); // namer created lazily; "A" is external → user latch + stop
    expect(b.peek()!._state()).toMatchObject({ nameSource: "user", hardStopped: true });
    b.restore({
      state: { hardStopped: true, attemptsUsed: 0 }, // cause-less stop = the latch artefact
      nameSource: "auto",
      nameSourceFor: "A",
    });
    expect(b.peek()!._state()).toMatchObject({ nameSource: "auto", hardStopped: false });
    b.sent.length = 0;
    b.observe("A"); // next turn-end
    expect(b.userClaims()).toHaveLength(0);
  });
});

describe("X4: session resume does not carry S1 into S2", () => {
  it("fresh namer for S2 adopts its own auto provenance; the first observation is not external", () => {
    // S1: a user-latched namer.
    const s1 = makeBridge();
    s1.observe("Hand Typed");
    expect(s1.peek()!._state().nameSource).toBe("user");
    // Resume: the bridge drops its namer + state (session_start handler) …
    expect(SRC).toContain("autoNamer = undefined;\n    namerState = undefined;\n    prev.namerState = undefined;");
    // … S2 is a fresh bridge state; register → restore for S2 → turn-end observes its own name.
    const s2 = makeBridge();
    s2.restore({ state: {}, nameSource: "auto", nameSourceFor: "Fix login" });
    s2.observe("Fix login");
    expect(s2.userClaims()).toHaveLength(0);
    expect(s2.peek()!._state()).toMatchObject({ nameSource: "auto", hardStopped: false });
  });
});
