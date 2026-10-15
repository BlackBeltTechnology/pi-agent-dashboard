/**
 * Question store: records keyed by (sessionId, promptId), opaque stable ids,
 * removal funnel, claim latch, durable rebind, brief orchestration
 * (test-plan #E1 #E2 #E4 #E5 #E8 #E13 #E15 #E18 #E23 #E24 #X1).
 * See change: add-pending-question-stack.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventStore } from "../../persistence/memory-event-store.js";
import type { BriefOutcome } from "../brief-generator.js";
import { createQuestionFileStore } from "../question-files.js";
import { createQuestionStore, TRANSMITTED_WINDOW_MS, type QuestionChange } from "../question-store.js";

const ID_RE = /^[A-Za-z0-9_-]{22}$/;

function promptMsg(sessionId: string, promptId: string, over: { type?: string; question?: string; options?: string[]; metadata?: Record<string, unknown>; placement?: string } = {}) {
  return {
    type: "prompt_request",
    sessionId,
    promptId,
    prompt: { question: over.question ?? "Resume or hand back?", type: over.type ?? "select", options: over.options ?? ["Resume", "Hand back"], metadata: over.metadata },
    component: { type: "x", props: {} },
    placement: over.placement ?? "inline",
  } as Record<string, unknown>;
}

const ok = (text = "A generated brief."): BriefOutcome => ({ ok: true, text, label: "generated", latencyMs: 5 });

describe("question store", () => {
  let home: string;
  let origHome: string | undefined;
  let clock: number;
  beforeEach(() => {
    origHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qstore-"));
    process.env.HOME = home;
    clock = 1_000_000;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const qdir = () => path.join(home, ".pi", "dashboard", "questions");
  const filesOnDisk = () => (fs.existsSync(qdir()) ? fs.readdirSync(qdir()).filter((n) => n.endsWith(".json")) : []);

  function make(over: { generate?: (...a: unknown[]) => Promise<BriefOutcome>; config?: { autoBrief: boolean; minBriefChars: number }; eventStore?: ReturnType<typeof createMemoryEventStore>; describe?: (sid: string) => unknown } = {}) {
    const generate = vi.fn(over.generate ?? (async () => ok()));
    const changes: QuestionChange[] = [];
    const store = createQuestionStore({
      eventStore: over.eventStore ?? createMemoryEventStore(() => false, 32, 20000, 100_000, 1_000_000),
      files: createQuestionFileStore(),
      describeSession: (over.describe as never) ?? ((sid: string) => ({ label: `label-${sid}` })),
      briefs: { generate: generate as never, stats: () => ({ ready: 0, failed: 0, unavailable: 0, fallbacks: 0, queued: 0, inFlight: 0 }) },
      config: () => over.config ?? { autoBrief: true, minBriefChars: 240 },
      now: () => clock,
    });
    store.onChange((c) => changes.push(c));
    return { store, generate, changes };
  }
  const settle = () => new Promise<void>((r) => setImmediate(r));

  describe("tracking + ids (test-plan #E5)", () => {
    it("tracked prompt → record; same id on re-send; new id for another prompt", () => {
      const { store } = make();
      const a = store.onTracked("s1", promptMsg("s1", "uuid1"))!;
      const again = store.onTracked("s1", promptMsg("s1", "uuid1"))!;
      const b = store.onTracked("s1", promptMsg("s1", "uuid2"))!;
      expect(again.id).toBe(a.id);
      expect(b.id).not.toBe(a.id);
      expect(a.id).toMatch(ID_RE);
      expect(a.id).not.toContain("s1");
      expect(store.listRows().length).toBe(2);
    });

    it("a prompt tracked again AFTER removal gets a new id", () => {
      const { store } = make();
      const a = store.onTracked("s1", promptMsg("s1", "uuid1"))!;
      store.removeQuestion("s1", "uuid1", "cleared");
      const b = store.onTracked("s1", promptMsg("s1", "uuid1"))!;
      expect(b.id).not.toBe(a.id);
    });

    it("ids are unguessable: 500 mints are unique and well-formed", () => {
      const { store } = make({ config: { autoBrief: false, minBriefChars: 240 } });
      const ids = new Set<string>();
      for (let i = 0; i < 500; i++) ids.add(store.onTracked("s1", promptMsg("s1", `p${i}`))!.id);
      expect(ids.size).toBe(500);
      for (const id of ids) expect(id).toMatch(ID_RE);
    });

    it("ignores a request without a promptId", () => {
      const { store } = make();
      expect(store.onTracked("s1", { type: "prompt_request", sessionId: "s1", prompt: { question: "q", type: "confirm" } })).toBeUndefined();
      expect(store.listRows()).toEqual([]);
    });

    it("emits `added` on first sight only", () => {
      const { store, changes } = make();
      store.onTracked("s1", promptMsg("s1", "p1"));
      store.onTracked("s1", promptMsg("s1", "p1"));
      expect(changes.filter((c) => c.kind === "added")).toHaveLength(1);
    });
  });

  describe("rows + detail", () => {
    it("builds a light row (no context bodies) with origin markers", () => {
      const { store } = make({ describe: (sid: string) => ({ label: "My session", changeName: "add-x", chatGateway: sid === "chat" }) });
      const long = "Q".repeat(300);
      store.onTracked("s1", promptMsg("s1", "p1", { question: long }));
      store.onTracked("s1", promptMsg("s1", "p2", { metadata: { kind: "agent-path-gate" } }));
      store.onTracked("s1", promptMsg("s1", "p3", { placement: "widget-bar" }));
      store.onTracked("chat", promptMsg("chat", "p4"));
      const rows = store.listRows();
      const byPrompt = (q: string) => rows.find((r) => r.preview.startsWith(q))!;
      const first = rows.find((r) => r.preview === "Q".repeat(140))!;
      expect(first).toMatchObject({ sessionId: "s1", sessionLabel: "My session", changeName: "add-x", type: "select", briefStatus: "pending" });
      expect(Object.keys(first).sort()).toEqual(["askedAt", "briefStatus", "changeName", "id", "preview", "sessionId", "sessionLabel", "type"].sort());
      expect(rows.filter((r) => r.origin === "file")).toHaveLength(1);
      expect(rows.filter((r) => r.origin === "widget-bar")).toHaveLength(1);
      expect(rows.filter((r) => r.origin === "chat-gateway")).toHaveLength(1);
      expect(byPrompt("Resume")).toBeDefined();
    });

    it("listRows(isVisible) filters per session; newest first", () => {
      const { store } = make({ config: { autoBrief: false, minBriefChars: 240 } });
      store.onTracked("a", promptMsg("a", "p1"));
      clock += 10;
      store.onTracked("b", promptMsg("b", "p2"));
      clock += 10;
      store.onTracked("a", promptMsg("a", "p3"));
      expect(store.listRows().map((r) => r.askedAt)).toEqual([1_000_020, 1_000_010, 1_000_000]);
      expect(store.listRows((sid) => sid === "b")).toHaveLength(1);
    });

    it("getDetail returns question, options, snapshot and answerable", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      const d = store.getDetail(rec.id)!;
      expect(d).toMatchObject({ id: rec.id, question: "Resume or hand back?", options: ["Resume", "Hand back"], answerable: true });
      expect(d.snapshot.redactionVersion).toBe(1);
      const file = store.onTracked("s1", promptMsg("s1", "p2", { metadata: { kind: "agent-path-gate-confirm" } }))!;
      expect(store.getDetail(file.id)!.answerable).toBe(false);
      expect(store.getDetail("nope")).toBeUndefined();
    });
  });

  describe("removal funnel (test-plan #E13)", () => {
    function seeded() {
      const ctx = make({ config: { autoBrief: false, minBriefChars: 240 } });
      ctx.store.onTracked("s1", promptMsg("s1", "p1"));
      ctx.store.onTracked("s1", promptMsg("s1", "p2"));
      ctx.store.onTracked("s2", promptMsg("s2", "p3"));
      ctx.changes.length = 0;
      return ctx;
    }

    it("removeQuestion: record gone, file deleted, `removed` emitted synchronously", () => {
      const { store, changes } = seeded();
      expect(filesOnDisk()).toHaveLength(3);
      expect(store.removeQuestion("s1", "p1", "cleared")).toBe(true);
      expect(changes).toEqual([expect.objectContaining({ kind: "removed", sessionId: "s1" })]);
      expect(filesOnDisk()).toHaveLength(2);
      expect(store.listRows().map((r) => r.sessionId).sort()).toEqual(["s1", "s2"]);
      expect(store.removeQuestion("s1", "p1", "cleared")).toBe(false);
      expect(changes).toHaveLength(1); // idempotent: no phantom broadcast
    });

    it("a removal loop flags every change but the last with `more` (one broadcast flush)", () => {
      const { store, changes } = seeded();
      store.removeQuestionsForSession("s1", "session-ended");
      expect(changes.map((c) => c.more === true)).toEqual([true, false]);
      changes.length = 0;
      store.removeQuestion("s2", "p3", "cleared");
      expect(changes).toEqual([expect.not.objectContaining({ more: true })]);
    });

    it("reconcileSession drops prompts missing from the re-sent set", () => {
      const { store, changes } = seeded();
      store.reconcileSession("s1", ["p2"]);
      expect(changes.map((c) => c.kind)).toEqual(["removed"]);
      expect(store.listRows().map((r) => r.sessionId).sort()).toEqual(["s1", "s2"]);
      expect(filesOnDisk()).toHaveLength(2);
    });

    it("removeQuestionsForSession drops every prompt of the session only", () => {
      const { store, changes } = seeded();
      store.removeQuestionsForSession("s1", "session-ended");
      expect(changes.filter((c) => c.kind === "removed")).toHaveLength(2);
      expect(store.listRows().map((r) => r.sessionId)).toEqual(["s2"]);
      expect(filesOnDisk()).toHaveLength(1);
    });

    it("a removed question's late brief result is dropped (no resurrection, no file)", async () => {
      let resolve!: (o: BriefOutcome) => void;
      const { store } = make({ generate: () => new Promise<BriefOutcome>((r) => (resolve = r)) });
      store.onTracked("s1", promptMsg("s1", "p1"));
      store.removeQuestion("s1", "p1", "cleared");
      resolve(ok());
      await settle();
      expect(filesOnDisk()).toEqual([]);
      expect(store.listRows()).toEqual([]);
    });
  });

  describe("transmit hides the row, registry entry unaffected (test-plan #E24)", () => {
    it("markTransmitted hides the row immediately and keeps the record", () => {
      const { store, changes } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      changes.length = 0;
      const claim = store.claim(rec.id);
      expect(claim).toEqual({ status: "claimed", id: rec.id });
      store.markTransmitted(rec.id);
      expect(changes).toEqual([expect.objectContaining({ kind: "hidden" })]);
      expect(store.listRows()).toEqual([]);
      expect(store.get(rec.id)).toBeDefined();
      expect(store.getDetail(rec.id)!.answerable).toBe(false);
    });
  });

  describe("lost answer: bridge re-send reopens a transmitted question", () => {
    it("transmit → re-send → listed again, answerable once, `added` emitted", () => {
      const { store, changes } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      store.claim(rec.id);
      store.markTransmitted(rec.id);
      expect(store.listRows()).toEqual([]);
      expect(store.lookup(rec.id).state).toBe("answered");
      changes.length = 0;

      const again = store.onTracked("s1", promptMsg("s1", "p1"))!; // bridge still waiting
      expect(again.id).toBe(rec.id);
      expect(changes).toEqual([expect.objectContaining({ kind: "added", id: rec.id })]);
      expect(store.listRows().map((r) => r.id)).toEqual([rec.id]);
      expect(store.lookup(rec.id).state).toBe("open");
      expect(store.getDetail(rec.id)!.answerable).toBe(true);

      // at-most-once still holds: exactly one of two concurrent claims wins
      expect([store.claim(rec.id).status, store.claim(rec.id).status]).toEqual(["claimed", "answered"]);
    });

    it("a re-send of an open or in-flight (claimed) question changes nothing", () => {
      const { store, changes } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      changes.length = 0;
      store.onTracked("s1", promptMsg("s1", "p1"));
      store.claim(rec.id);
      store.onTracked("s1", promptMsg("s1", "p1"));
      expect(changes).toEqual([]);
      expect(store.claim(rec.id).status).toBe("answered");
    });
  });

  describe("malformed batch metadata (audit)", () => {
    it("non-object sub-question entries are dropped", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { type: "batch", metadata: { questions: [null, "x", 7, [], { question: "q", method: "confirm" }] } }))!;
      expect(rec.questions).toEqual([{ question: "q", method: "confirm" }]);
    });
  });

  describe("claim latch (tasks 5.x contract)", () => {
    it("first claim wins; second is `answered`; release re-opens", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      expect(store.claim(rec.id).status).toBe("claimed");
      expect(store.claim(rec.id).status).toBe("answered");
      expect(store.claimPrompt("s1", "p1").status).toBe("answered");
      store.releaseClaim(rec.id);
      expect(store.claimPrompt("s1", "p1")).toEqual({ status: "claimed", id: rec.id });
    });

    it("claimPrompt for an untracked prompt is `unknown` (caller proceeds)", () => {
      const { store } = make();
      expect(store.claimPrompt("s1", "nope").status).toBe("unknown");
      expect(store.claim("nope").status).toBe("unknown");
    });

    it("claimPrompt never claims a file-access prompt (own approval road)", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: { kind: "agent-path-gate" } }))!;
      expect(store.claimPrompt("s1", "p1").status).toBe("unknown");
      expect(store.claimPrompt("s1", "p1").status).toBe("unknown");
      expect(store.getDetail(rec.id)!.answerable).toBe(false);
    });

    it("releaseClaim never reopens a transmitted answer", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      store.claim(rec.id);
      store.markTransmitted(rec.id);
      store.releaseClaim(rec.id);
      expect(store.claim(rec.id).status).toBe("answered");
    });

    it("lookup: 409 window boundary, then unknown (test-plan #E8)", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      expect(store.lookup(rec.id).state).toBe("open");
      store.claim(rec.id);
      store.markTransmitted(rec.id);
      clock += TRANSMITTED_WINDOW_MS - 1_000; // t0 + 9:59
      expect(store.lookup(rec.id).state).toBe("answered");
      clock += 2_000; // t0 + 10:01
      expect(store.lookup(rec.id).state).toBe("unknown");
    });

    it("the window survives the registry echo removing the record", () => {
      const { store } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      store.claim(rec.id);
      store.markTransmitted(rec.id);
      store.removeQuestion("s1", "p1", "dismissed"); // prompt_dismiss echo
      expect(store.lookup(rec.id).state).toBe("answered");
      expect(store.claim(rec.id).status).toBe("answered");
      clock += TRANSMITTED_WINDOW_MS + 1_000;
      expect(store.lookup(rec.id).state).toBe("unknown");
      expect(store.claim(rec.id).status).toBe("unknown");
    });

    it("a fresh store (restart) has no memory of an old id → unknown", () => {
      const first = make();
      const rec = first.store.onTracked("s1", promptMsg("s1", "p1"))!;
      first.store.claim(rec.id);
      first.store.markTransmitted(rec.id);
      expect(make().store.lookup(rec.id).state).toBe("unknown");
    });
  });

  describe("brief orchestration (test-plan #E2, #E4, #E18)", () => {
    it.each([
      [0, undefined, "pending", 1],
      [239, "m".repeat(239), "pending", 1],
      [240, "m".repeat(240), "provided", 0],
      [241, "m".repeat(241), "provided", 0],
    ])("message of %s chars → %s (calls: %s)", async (_len, message, status, calls) => {
      const { store, generate } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: message ? { message } : undefined }))!;
      expect(rec.briefStatus).toBe(status);
      await settle();
      expect(generate).toHaveBeenCalledTimes(calls);
      if (status === "provided") expect(store.getDetail(rec.id)).toMatchObject({ brief: message, briefLabel: "provided", briefStatus: "provided" });
      else expect(store.getDetail(rec.id)).toMatchObject({ briefStatus: "ready", brief: "A generated brief.", briefLabel: "generated" });
    });

    it("pending → ready emits a debounced-class `brief` change and persists", async () => {
      const { store, changes } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      changes.length = 0;
      await settle();
      expect(changes).toEqual([expect.objectContaining({ kind: "brief", id: rec.id })]);
      const file = JSON.parse(fs.readFileSync(path.join(qdir(), `${rec.id}.json`), "utf8"));
      expect(file).toMatchObject({ briefStatus: "ready", brief: "A generated brief.", briefLabel: "generated", sessionId: "s1", promptId: "p1" });
    });

    it("limited-context generation keeps its label", async () => {
      const { store } = make({ generate: async () => ({ ok: true, text: "thin", label: "generated-limited", latencyMs: 1 }) });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(store.getDetail(rec.id)!.briefLabel).toBe("generated-limited");
    });

    it("autoBrief=false → unavailable, zero calls (test-plan #E4)", async () => {
      const { store, generate } = make({ config: { autoBrief: false, minBriefChars: 240 } });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(generate).not.toHaveBeenCalled();
      expect(store.getDetail(rec.id)!.briefStatus).toBe("unavailable");
    });

    it("generator reports unavailable → briefStatus unavailable (test-plan #E18)", async () => {
      const { store } = make({ generate: async () => ({ ok: false, kind: "unavailable", reason: "no role", latencyMs: 0 }) });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(store.getDetail(rec.id)!.briefStatus).toBe("unavailable");
    });

    it("generation failure → failed tombstone, not retried by a re-send (test-plan #X1)", async () => {
      const { store, generate } = make({ generate: async () => ({ ok: false, kind: "failed", reason: "timed out", latencyMs: 20000 }) });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(store.getDetail(rec.id)!.briefStatus).toBe("failed");
      store.onTracked("s1", promptMsg("s1", "p1"));
      await settle();
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("the generation request carries question, options, message and the snapshot", async () => {
      const es = createMemoryEventStore(() => false, 32, 20000, 100_000, 1_000_000);
      es.insertEvent("s1", { eventType: "message_end", timestamp: 1, data: { message: { role: "assistant", content: "I was fixing CI" } } });
      const { store, generate } = make({ eventStore: es });
      store.onTracked("s1", promptMsg("s1", "p1", { metadata: { message: "short ctx" } }));
      expect(generate.mock.calls[0][0]).toMatchObject({ question: "Resume or hand back?", type: "select", options: ["Resume", "Hand back"], message: "short ctx", snapshot: { assistantText: "I was fixing CI" } });
    });
  });

  describe("summarize on demand (tasks 4.2, 5.x)", () => {
    it("replaces a provided brief with a generated one and persists it", async () => {
      const { store, generate } = make({ generate: async () => ok("on demand") });
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: { message: "m".repeat(300) } }))!;
      const res = await store.summarize(rec.id);
      expect(res).toMatchObject({ ok: true });
      expect(generate).toHaveBeenCalledTimes(1);
      expect(store.getDetail(rec.id)).toMatchObject({ brief: "on demand", briefLabel: "generated", briefStatus: "ready" });
      const file = JSON.parse(fs.readFileSync(path.join(qdir(), `${rec.id}.json`), "utf8"));
      expect(file.brief).toBe("on demand");
    });

    it("failure keeps the current brief and returns an error; a retry can succeed", async () => {
      let n = 0;
      const { store } = make({ generate: async () => (++n === 1 ? { ok: false, kind: "failed", reason: "timed out", latencyMs: 1 } : ok("second")) });
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: { message: "m".repeat(300) } }))!;
      const bad = await store.summarize(rec.id);
      expect(bad).toMatchObject({ ok: false, reason: "failed" });
      expect(store.getDetail(rec.id)).toMatchObject({ briefStatus: "provided", brief: "m".repeat(300) });
      expect((await store.summarize(rec.id)).ok).toBe(true);
      expect(store.getDetail(rec.id)!.brief).toBe("second");
    });

    it("a failed tombstone can be retried on demand; success clears it", async () => {
      let n = 0;
      const { store } = make({ generate: async () => (++n === 1 ? { ok: false, kind: "failed", reason: "x", latencyMs: 1 } : ok("recovered")) });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(store.getDetail(rec.id)!.briefStatus).toBe("failed");
      expect((await store.summarize(rec.id)).ok).toBe(true);
      expect(store.getDetail(rec.id)).toMatchObject({ briefStatus: "ready", brief: "recovered" });
    });

    it("refuses an already-generated brief and an unknown id", async () => {
      const { store, generate } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(await store.summarize(rec.id)).toMatchObject({ ok: false, reason: "already-generated" });
      expect(await store.summarize("nope")).toMatchObject({ ok: false, reason: "not-found" });
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it("concurrent summarize calls share one generation", async () => {
      let resolve!: (o: BriefOutcome) => void;
      const { store, generate } = make({ generate: () => new Promise<BriefOutcome>((r) => (resolve = r)), config: { autoBrief: false, minBriefChars: 240 } });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      const a = store.summarize(rec.id);
      const b = store.summarize(rec.id);
      resolve(ok("once"));
      expect((await a).ok && (await b).ok).toBe(true);
      expect(generate).toHaveBeenCalledTimes(1);
    });
  });

  describe("provided brief redacted before persist (security audit)", () => {
    it("a 300-char message holding a PEM key leaves no key in the file or the detail brief", () => {
      const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END RSA PRIVATE KEY-----";
      const message = `${"c".repeat(120)} ${pem} ${"d".repeat(120)}`;
      expect(message.length).toBeGreaterThanOrEqual(240);
      const { store, generate } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: { message } }))!;
      const raw = fs.readFileSync(path.join(qdir(), `${rec.id}.json`), "utf8");
      expect(raw).not.toContain("MIIEvQIBADANBg");
      expect(JSON.stringify(store.getDetail(rec.id))).not.toContain("MIIEvQIBADANBg");
      expect(store.getDetail(rec.id)).toMatchObject({ briefStatus: "provided", briefLabel: "provided" });
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("file-access prompts are never auto-briefed (security audit)", () => {
    it.each(["agent-path-gate", "agent-path-gate-confirm"])("%s → unavailable, no model call (auto or on-demand)", async (kind) => {
      const { store, generate } = make();
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: { kind } }))!;
      await settle();
      expect(rec.briefStatus).toBe("unavailable");
      expect(generate).not.toHaveBeenCalled();
      expect(await store.summarize(rec.id)).toMatchObject({ ok: false, reason: "unavailable" });
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("auto generation never rejects unhandled", () => {
    it("a generate() that throws synchronously-ish is contained and recorded as failed", async () => {
      const { store } = make({ generate: async () => { throw new Error("boom"); } });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(rec.briefStatus).toBe("failed");
    });
  });

  describe("snapshot persisted redacted (test-plan #E15)", () => {
    it("no secret reaches the question file; version stored", () => {
      const es = createMemoryEventStore(() => false, 32, 20000, 100_000, 1_000_000);
      es.insertEvent("s1", { eventType: "message_end", timestamp: 1, data: { message: { role: "assistant", content: "use password: hunter2hunter2 and AKIAABCDEFGHIJKLMNOP" } } });
      const { store } = make({ eventStore: es, config: { autoBrief: false, minBriefChars: 240 } });
      const rec = store.onTracked("s1", promptMsg("s1", "p1", { metadata: { workflowRun: { token: "sk-abcdefghijklmnop1234" } } }))!;
      const raw = fs.readFileSync(path.join(qdir(), `${rec.id}.json`), "utf8");
      for (const leak of ["hunter2hunter2", "AKIAABCDEFGHIJKLMNOP", "sk-abcdefghijklmnop1234"]) expect(raw).not.toContain(leak);
      expect(JSON.parse(raw).snapshot.redactionVersion).toBe(1);
    });
  });

  describe("snapshot is immutable (test-plan #E14)", () => {
    it("later events and re-sends do not change the stored snapshot", () => {
      const es = createMemoryEventStore(() => false, 32, 20000, 100_000, 1_000_000);
      es.insertEvent("s1", { eventType: "message_end", timestamp: 1, data: { message: { role: "assistant", content: "before" } } });
      const { store } = make({ eventStore: es, config: { autoBrief: false, minBriefChars: 240 } });
      const rec = store.onTracked("s1", promptMsg("s1", "p1"))!;
      es.insertEvent("s1", { eventType: "message_end", timestamp: 2, data: { message: { role: "assistant", content: "after" } } });
      store.onTracked("s1", promptMsg("s1", "p1"));
      expect(store.getDetail(rec.id)!.snapshot.assistantText).toBe("before");
    });
  });

  describe("restart durability (test-plan #E23, #X1, tasks 4.4)", () => {
    it("re-send after restart rebinds id + snapshot + brief with ZERO model calls, even 5+ min later", async () => {
      const first = make();
      const rec = first.store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      const brief = first.store.getDetail(rec.id)!;

      clock += 6 * 60_000; // beyond the 5-min quarantine
      const second = make();
      second.store.loadPersisted();
      expect(second.store.listRows()).toEqual([]); // nothing listed until the bridge re-sends
      const again = second.store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      expect(again.id).toBe(rec.id);
      expect(second.generate).not.toHaveBeenCalled();
      expect(second.store.getDetail(rec.id)).toMatchObject({ brief: brief.brief, briefStatus: "ready", briefLabel: "generated", askedAt: brief.askedAt });
    });

    it("the failed tombstone survives restart: still failed, zero extra calls", async () => {
      const first = make({ generate: async () => ({ ok: false, kind: "failed", reason: "timed out", latencyMs: 20000 }) });
      const rec = first.store.onTracked("s1", promptMsg("s1", "p1"))!;
      await settle();
      const second = make();
      second.store.loadPersisted();
      second.store.onTracked("s1", promptMsg("s1", "p1"));
      await settle();
      expect(second.generate).not.toHaveBeenCalled();
      expect(second.store.getDetail(rec.id)!.briefStatus).toBe("failed");
    });

    it("an attempt interrupted by the restart (file still pending) counts as the one attempt → failed", async () => {
      const first = make({ generate: () => new Promise<BriefOutcome>(() => {}) });
      const rec = first.store.onTracked("s1", promptMsg("s1", "p1"))!;
      const second = make();
      second.store.loadPersisted();
      second.store.onTracked("s1", promptMsg("s1", "p1"));
      await settle();
      expect(second.generate).not.toHaveBeenCalled();
      expect(second.store.getDetail(rec.id)!.briefStatus).toBe("failed");
    });

    it("boot sweep deletes only unknown/ended sessions' files (test-plan #E23)", async () => {
      const first = make({ config: { autoBrief: false, minBriefChars: 240 } });
      const live = first.store.onTracked("live", promptMsg("live", "p1"))!;
      first.store.onTracked("unknown", promptMsg("unknown", "p2"));
      first.store.onTracked("ended", promptMsg("ended", "p3"));
      const second = make();
      second.store.loadPersisted();
      const deleted = second.store.sweepAtBoot((sid) => (sid === "live" ? "present" : sid === "ended" ? "ended" : "unknown"));
      expect(deleted).toHaveLength(2);
      expect(filesOnDisk()).toEqual([`${live.id}.json`]);
      // The survivor rebinds; the swept one mints fresh.
      expect(second.store.onTracked("live", promptMsg("live", "p1"))!.id).toBe(live.id);
      expect(second.store.onTracked("unknown", promptMsg("unknown", "p2"))!.id).not.toBe("");
      expect(fs.statSync(path.join(qdir(), `${live.id}.json`)).mode & 0o777).toBe(0o600);
    });

    it("reconcile after restart drops persisted-but-not-re-sent prompts and their files", async () => {
      const first = make({ config: { autoBrief: false, minBriefChars: 240 } });
      first.store.onTracked("s1", promptMsg("s1", "kept"));
      first.store.onTracked("s1", promptMsg("s1", "gone"));
      const second = make();
      second.store.loadPersisted();
      second.store.onTracked("s1", promptMsg("s1", "kept"));
      second.store.reconcileSession("s1", ["kept"]);
      expect(filesOnDisk()).toHaveLength(1);
    });

    it("session end and per-prompt removal also delete persisted-but-unbound files", async () => {
      const first = make({ config: { autoBrief: false, minBriefChars: 240 } });
      first.store.onTracked("s1", promptMsg("s1", "p1"));
      first.store.onTracked("s2", promptMsg("s2", "p2"));
      const second = make();
      second.store.loadPersisted();
      second.store.removeQuestionsForSession("s1", "session-ended");
      second.store.removeQuestion("s2", "p2", "dismissed");
      expect(filesOnDisk()).toEqual([]);
    });
  });

  it("a throwing change listener never breaks tracking", () => {
    const { store } = make();
    store.onChange(() => {
      throw new Error("listener boom");
    });
    expect(() => store.onTracked("s1", promptMsg("s1", "p1"))).not.toThrow();
    expect(store.listRows()).toHaveLength(1);
  });
});
