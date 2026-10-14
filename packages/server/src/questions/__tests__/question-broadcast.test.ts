/**
 * `questions_update` per-recipient visibility + debounce policy
 * (test-plan #E9 broadcast road, #E13 immediacy; tasks 3.5, D7).
 * See change: add-pending-question-stack.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import { createQuestionBroadcaster, createQuestionVisibility, QUESTIONS_DEBOUNCE_MS } from "../question-broadcast.js";
import { createQuestionFileStore } from "../question-files.js";
import { createQuestionStore } from "../question-store.js";

type Principal = { iss: string; sub: string };
const anna: Principal = { iss: "kc", sub: "anna" };
const bela: Principal = { iss: "kc", sub: "bela" };

interface FakeSocket { id: string; principal: Principal | null; frames: Array<{ type: string; questions: Array<{ sessionId: string; id: string }> }> }
const sock = (id: string, principal: Principal | null): FakeSocket => ({ id, principal, frames: [] });

function promptMsg(sessionId: string, promptId: string) {
  return { type: "prompt_request", sessionId, promptId, prompt: { question: `q-${promptId}`, type: "confirm" }, placement: "inline" } as Record<string, unknown>;
}

describe("question broadcaster", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    origHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qbc-"));
    process.env.HOME = home;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.HOME = origHome;
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function setup(opts: { active: boolean; owners?: Record<string, Principal | undefined>; sockets: FakeSocket[] }) {
    const store = createQuestionStore({
      eventStore: createMemoryEventStore(() => false),
      files: createQuestionFileStore(),
      describeSession: (sid) => ({ label: sid }),
      briefs: { generate: vi.fn(async () => ({ ok: true as const, text: "b", label: "generated" as const, latencyMs: 1 })), stats: () => ({ ready: 0, failed: 0, unavailable: 0, fallbacks: 0, queued: 0, inFlight: 0 }) },
      config: () => ({ autoBrief: false, minBriefChars: 240 }),
    });
    const canSee = createQuestionVisibility<FakeSocket>({
      isResolverActive: () => opts.active,
      principalOf: (ws) => ws.principal,
      ownerOf: (sid) => opts.owners?.[sid],
    });
    const bc = createQuestionBroadcaster<FakeSocket>({
      store,
      sockets: () => opts.sockets,
      send: (ws, msg) => ws.frames.push(msg as never),
      canSee,
    });
    return { store, bc, canSee };
  }
  const last = (ws: FakeSocket) => ws.frames[ws.frames.length - 1];

  describe("visibility decision table (test-plan #E9)", () => {
    it("no resolver → every socket sees every question, ownerless included", () => {
      const a = sock("a", anna);
      const none = sock("none", null);
      const { store, bc } = setup({ active: false, owners: { s1: anna, s2: undefined }, sockets: [a, none] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      store.onTracked("s2", promptMsg("s2", "p2"));
      bc.flush();
      for (const ws of [a, none]) expect(last(ws).questions.map((q) => q.sessionId).sort()).toEqual(["s1", "s2"]);
    });

    it("resolver active → owner equality per item; ownerless hidden from humans; other owners hidden", () => {
      const a = sock("a", anna);
      const b = sock("b", bela);
      const none = sock("none", null);
      const { store, bc } = setup({ active: true, owners: { s1: anna, s2: bela, s3: undefined }, sockets: [a, b, none] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      store.onTracked("s2", promptMsg("s2", "p2"));
      store.onTracked("s3", promptMsg("s3", "p3")); // ownerless automation run
      bc.flush();
      expect(last(a).questions.map((q) => q.sessionId)).toEqual(["s1"]);
      expect(last(b).questions.map((q) => q.sessionId)).toEqual(["s2"]);
      expect(last(none)?.questions ?? []).toEqual([]);
    });

    it("a socket that may see nothing gets no frame for another owner's add (no oracle)", () => {
      const a = sock("a", anna);
      const b = sock("b", bela);
      const { store, bc } = setup({ active: true, owners: { s1: anna }, sockets: [a, b] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      bc.flush();
      expect(a.frames).toHaveLength(1);
      expect(b.frames).toHaveLength(0);
    });
  });

  describe("debounce policy (D7)", () => {
    it("adds are coalesced into ONE frame after the trailing window", () => {
      const a = sock("a", anna);
      const { store } = setup({ active: false, sockets: [a] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      store.onTracked("s1", promptMsg("s1", "p2"));
      expect(a.frames).toHaveLength(0);
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS - 1);
      expect(a.frames).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(a.frames).toHaveLength(1);
      expect(last(a).questions).toHaveLength(2);
      expect(QUESTIONS_DEBOUNCE_MS).toBe(250);
    });

    it("a brief change is debounced too", async () => {
      const a = sock("a", anna);
      const { store } = setup({ active: false, sockets: [a] });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS);
      a.frames.length = 0;
      await store.summarize(rec.id); // brief → ready
      expect(a.frames).toHaveLength(0);
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS);
      expect(a.frames).toHaveLength(1);
    });

    it("removal is IMMEDIATE (same tick) and carries a still-pending add", () => {
      const a = sock("a", anna);
      const { store } = setup({ active: false, sockets: [a] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS);
      store.onTracked("s1", promptMsg("s1", "p2")); // pending add
      a.frames.length = 0;
      store.removeQuestion("s1", "p1", "cleared");
      expect(a.frames).toHaveLength(1);
      expect(last(a).questions.map((q) => q.id)).toHaveLength(1); // p2 only
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS * 2);
      expect(a.frames).toHaveLength(1); // the timer's frame was deduped / cancelled
    });

    it("transmit (`hidden`) is immediate too", () => {
      const a = sock("a", anna);
      const { store } = setup({ active: false, sockets: [a] });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS);
      a.frames.length = 0;
      store.claim(rec.id);
      store.markTransmitted(rec.id);
      expect(last(a).questions).toEqual([]);
    });

    it("session end removes immediately for every recipient", () => {
      const a = sock("a", anna);
      const b = sock("b", bela);
      const { store } = setup({ active: false, sockets: [a, b] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      vi.advanceTimersByTime(QUESTIONS_DEBOUNCE_MS);
      a.frames.length = 0;
      b.frames.length = 0;
      store.removeQuestionsForSession("s1", "session-ended");
      expect(last(a).questions).toEqual([]);
      expect(last(b).questions).toEqual([]);
    });
  });

  describe("connect + lifecycle", () => {
    it("sendTo gives a new socket the current rows (rows only, no bodies), even when empty", () => {
      const a = sock("a", anna);
      const { store, bc } = setup({ active: false, sockets: [] });
      bc.sendTo(a);
      expect(last(a)).toEqual({ type: "questions_update", questions: [] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      const late = sock("late", anna);
      bc.sendTo(late);
      const row = last(late).questions[0] as unknown as Record<string, unknown>;
      expect(row.sessionId).toBe("s1");
      for (const body of ["question", "snapshot", "brief", "options"]) expect(row).not.toHaveProperty(body);
    });

    it("sendTo honours the recipient's visibility", () => {
      const b = sock("b", bela);
      const { store, bc } = setup({ active: true, owners: { s1: anna }, sockets: [] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      bc.sendTo(b);
      expect(last(b).questions).toEqual([]);
    });

    it("refresh() re-evaluates visibility (owner stamped after the question)", () => {
      const a = sock("a", anna);
      const owners: Record<string, Principal | undefined> = { s1: undefined };
      const { store, bc } = setup({ active: true, owners, sockets: [a] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      bc.flush();
      expect(a.frames).toHaveLength(0);
      owners.s1 = anna;
      bc.flush();
      expect(last(a).questions).toHaveLength(1);
    });

    it("dispose cancels the pending timer and unsubscribes", () => {
      const a = sock("a", anna);
      const { store, bc } = setup({ active: false, sockets: [a] });
      store.onTracked("s1", promptMsg("s1", "p1"));
      bc.dispose();
      vi.advanceTimersByTime(1000);
      store.onTracked("s1", promptMsg("s1", "p2"));
      vi.advanceTimersByTime(1000);
      expect(a.frames).toHaveLength(0);
    });

    it("a throwing send never breaks the fan-out to other sockets", () => {
      const bad = sock("bad", anna);
      const good = sock("good", anna);
      const store = createQuestionStore({
        eventStore: createMemoryEventStore(() => false),
        files: createQuestionFileStore(),
        describeSession: () => ({ label: "x" }),
        briefs: { generate: vi.fn(), stats: () => ({ ready: 0, failed: 0, unavailable: 0, fallbacks: 0, queued: 0, inFlight: 0 }) },
        config: () => ({ autoBrief: false, minBriefChars: 240 }),
      });
      const bc = createQuestionBroadcaster<FakeSocket>({
        store,
        sockets: () => [bad, good],
        send: (ws, msg) => {
          if (ws === bad) throw new Error("socket closed");
          ws.frames.push(msg as never);
        },
        canSee: () => true,
      });
      store.onTracked("s1", promptMsg("s1", "p1"));
      expect(() => bc.flush()).not.toThrow();
      expect(good.frames).toHaveLength(1);
    });
  });
});
