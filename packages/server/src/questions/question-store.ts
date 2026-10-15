/**
 * Question store: owns one `QuestionRecord` per pending PromptBus prompt,
 * keyed by (sessionId, promptId). Hooked from the gateway's pending-prompt
 * registry (the notify guard in event-wiring runs BEFORE tracking, so notify
 * shaped requests never arrive here) and from every registry removal path.
 *
 *  - ids: random 128-bit base64url (22 chars), minted once per (sessionId,
 *    promptId); a re-send maps to the same id (key lookup before minting).
 *  - removal funnel: `removeQuestion` / `reconcileSession` /
 *    `removeQuestionsForSession` delete the record AND its file and emit an
 *    immediate `removed` change (the broadcaster does not debounce removals).
 *  - claim latch: a SYNCHRONOUS at-most-one-answer latch shared by REST and
 *    the browser `prompt_response` road. `markTransmitted` hides the row at
 *    once; the registry entry stays until the bridge's `prompt_dismiss` echo.
 *    A transmitted claim is remembered 10 min in memory only (409 window).
 *  - snapshot (immutable, redacted) + brief (policy in `brief-policy.ts`,
 *    generation in `brief-generator.ts`) are persisted per question
 *    (`question-files.ts`) so a re-send after a server restart rebinds them
 *    with zero model calls.
 * See change: add-pending-question-stack (D1, D2, D4, D6, D8).
 */
import { randomBytes } from "node:crypto";
import type { BatchQuestion } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import {
  QUESTION_PREVIEW_MAX,
  type BriefLabel,
  type BriefStatus,
  type QuestionDetail,
  type QuestionOrigin,
  type QuestionRow,
  type QuestionSnapshot,
} from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { QuestionsConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import type { BriefGenerator, BriefOutcome } from "./brief-generator.js";
import { contextMessageOf, decideBriefPolicy } from "./brief-policy.js";
import type { QuestionFile, QuestionFileStore, SessionPresence } from "./question-files.js";
import { buildQuestionSnapshot } from "./question-snapshot.js";

/** How long a transmitted answer is remembered for the 409 window. */
export const TRANSMITTED_WINDOW_MS = 10 * 60_000;

/** File-access prompt kinds (read-only in the stack; own approval road). */
export const FILE_ACCESS_KINDS: readonly string[] = ["agent-path-gate", "agent-path-gate-confirm"];

export type RemovalReason = "cleared" | "reconciled" | "session-ended" | "dismissed" | "cancelled" | (string & {});

export interface SessionDescriptor {
  label: string;
  changeName?: string;
  /** Session belongs to the chat-gateway plugin. */
  chatGateway?: boolean;
}

export interface QuestionChange {
  /** `added`/`brief` are debounce-class; `hidden`/`removed` must be broadcast at once. */
  kind: "added" | "brief" | "hidden" | "removed";
  id: string;
  sessionId: string;
}

export type ClaimResult = { status: "claimed"; id: string } | { status: "answered" } | { status: "unknown" };
export type LookupResult = { state: "open"; record: QuestionRecord } | { state: "answered" } | { state: "unknown" };
export type SummarizeResult =
  | { ok: true; detail: QuestionDetail }
  | { ok: false; reason: "not-found" | "already-generated" | "unavailable" | "failed"; error: string };

export interface QuestionRecord {
  id: string;
  sessionId: string;
  promptId: string;
  askedAt: number;
  type: string;
  question: string;
  options?: string[];
  questions?: BatchQuestion[];
  origin?: QuestionOrigin;
  /** Context message (`metadata.message`); in memory only, never persisted. */
  message?: string;
  snapshot: QuestionSnapshot;
  brief?: string;
  briefLabel?: BriefLabel;
  briefStatus: BriefStatus;
  /** Answer latch: undefined = open, `claimed` = in flight, `transmitted` = sent. */
  claim?: "claimed" | "transmitted";
  transmittedAt?: number;
  /** In-flight generation, shared by the automatic run and on-demand calls. */
  inflight?: Promise<BriefOutcome>;
}

export interface QuestionStoreDeps {
  eventStore: Pick<EventStore, "getMaxSeq" | "getEventsEndingAt">;
  files: QuestionFileStore;
  describeSession: (sessionId: string) => SessionDescriptor | undefined;
  briefs: Pick<BriefGenerator, "generate" | "stats">;
  config: () => QuestionsConfig;
  now?: () => number;
  mintId?: () => string;
}

export interface QuestionStore {
  onTracked(sessionId: string, msg: Record<string, unknown>): QuestionRecord | undefined;
  removeQuestion(sessionId: string, promptId: string, reason: RemovalReason): boolean;
  /** Drop every question of the session whose prompt id is NOT in `keepPromptIds`. */
  reconcileSession(sessionId: string, keepPromptIds: readonly string[]): void;
  removeQuestionsForSession(sessionId: string, reason: RemovalReason): void;
  get(id: string): QuestionRecord | undefined;
  getDetail(id: string): QuestionDetail | undefined;
  /** Rows of open (not transmitted) questions, newest first, filtered per session. */
  listRows(isVisible?: (sessionId: string) => boolean): QuestionRow[];
  lookup(id: string): LookupResult;
  claim(id: string): ClaimResult;
  claimPrompt(sessionId: string, promptId: string): ClaimResult;
  releaseClaim(id: string): void;
  markTransmitted(id: string): void;
  /** On-demand generation (allowed for any non-generated brief). */
  summarize(id: string): Promise<SummarizeResult>;
  onChange(listener: (change: QuestionChange) => void): () => void;
  /** Read persisted question files into the rebind index (boot, sync). */
  loadPersisted(): void;
  /** Delete files whose session is unknown/ended; returns deleted ids. */
  sweepAtBoot(presence: (sessionId: string) => SessionPresence): string[];
  getStats(): { open: number; hidden: number; persistedUnbound: number; transmittedWindow: number; briefs: ReturnType<BriefGenerator["stats"]> };
}

const keyOf = (sessionId: string, promptId: string) => `${sessionId}\u0000${promptId}`;

export function createQuestionStore(deps: QuestionStoreDeps): QuestionStore {
  const now = deps.now ?? Date.now;
  const mint = deps.mintId ?? (() => randomBytes(16).toString("base64url"));
  const byKey = new Map<string, QuestionRecord>();
  const byId = new Map<string, QuestionRecord>();
  /** Persisted files not yet re-sent by their bridge (key → file). */
  const persisted = new Map<string, QuestionFile>();
  const tombstones = new Map<string, number>();
  const listeners = new Set<(c: QuestionChange) => void>();

  function emit(change: QuestionChange): void {
    for (const l of [...listeners]) {
      try {
        l(change);
      } catch (err) {
        console.error("[questions] change listener failed:", (err as Error).message);
      }
    }
  }

  function sweepTombstones(): void {
    const cutoff = now() - TRANSMITTED_WINDOW_MS;
    for (const [id, at] of tombstones) if (at <= cutoff) tombstones.delete(id);
  }
  const answeredRecently = (id: string): boolean => {
    sweepTombstones();
    return tombstones.has(id);
  };

  function newId(): string {
    for (;;) {
      const id = mint();
      if (!byId.has(id) && !tombstones.has(id) && ![...persisted.values()].some((f) => f.id === id)) return id;
    }
  }

  function persist(rec: QuestionRecord): void {
    const file: QuestionFile = {
      version: 1,
      id: rec.id,
      sessionId: rec.sessionId,
      promptId: rec.promptId,
      askedAt: rec.askedAt,
      snapshot: rec.snapshot,
      briefStatus: rec.briefStatus,
      ...(rec.brief !== undefined ? { brief: rec.brief } : {}),
      ...(rec.briefLabel ? { briefLabel: rec.briefLabel } : {}),
    };
    try {
      deps.files.write(file);
    } catch (err) {
      console.error(`[questions] cannot persist question ${rec.id}:`, (err as Error).message);
    }
  }

  function originOf(msg: Record<string, unknown>, session: SessionDescriptor | undefined): QuestionOrigin | undefined {
    const meta = (msg.prompt as { metadata?: { kind?: unknown } } | undefined)?.metadata;
    if (typeof meta?.kind === "string" && FILE_ACCESS_KINDS.includes(meta.kind)) return "file";
    if (session?.chatGateway) return "chat-gateway";
    if (msg.placement === "widget-bar") return "widget-bar";
    return undefined;
  }

  function dropRecord(rec: QuestionRecord, kind: "removed"): void {
    byKey.delete(keyOf(rec.sessionId, rec.promptId));
    byId.delete(rec.id);
    deps.files.remove(rec.id);
    emit({ kind, id: rec.id, sessionId: rec.sessionId });
  }

  function dropPersisted(key: string): void {
    const file = persisted.get(key);
    if (!file) return;
    persisted.delete(key);
    deps.files.remove(file.id);
  }

  function requestOf(rec: QuestionRecord) {
    return {
      question: rec.question,
      type: rec.type,
      ...(rec.options ? { options: rec.options } : {}),
      ...(rec.questions ? { subQuestions: rec.questions } : {}),
      ...(rec.message !== undefined ? { message: rec.message } : {}),
      snapshot: rec.snapshot,
    };
  }

  const isLive = (rec: QuestionRecord) => byId.get(rec.id) === rec;

  /** One generation per record at a time; `auto` records every outcome, on-demand only a success. */
  function runGeneration(rec: QuestionRecord, mode: "auto" | "on-demand"): Promise<BriefOutcome> {
    if (rec.inflight !== undefined) return rec.inflight;
    const p: Promise<BriefOutcome> = deps.briefs
      .generate(requestOf(rec))
      .catch((err): BriefOutcome => ({ ok: false, kind: "failed", reason: (err as Error)?.message ?? String(err), latencyMs: 0 }))
      .then((outcome) => {
        rec.inflight = undefined;
        if (!isLive(rec)) return outcome; // removed meanwhile: never resurrect or write a file
        if (outcome.ok) {
          rec.brief = outcome.text;
          rec.briefLabel = outcome.label;
          rec.briefStatus = "ready";
        } else if (mode === "auto") {
          rec.briefStatus = outcome.kind;
        } else {
          return outcome; // on-demand failure keeps the current brief
        }
        persist(rec);
        emit({ kind: "brief", id: rec.id, sessionId: rec.sessionId });
        return outcome;
      });
    rec.inflight = p;
    return p;
  }

  function rowOf(rec: QuestionRecord): QuestionRow {
    const session = deps.describeSession(rec.sessionId);
    return {
      id: rec.id,
      sessionId: rec.sessionId,
      sessionLabel: session?.label ?? rec.sessionId,
      ...(session?.changeName ? { changeName: session.changeName } : {}),
      preview: rec.question.slice(0, QUESTION_PREVIEW_MAX),
      type: rec.type,
      ...(rec.origin ? { origin: rec.origin } : {}),
      askedAt: rec.askedAt,
      briefStatus: rec.briefStatus,
    };
  }

  function detailOf(rec: QuestionRecord): QuestionDetail {
    return {
      ...rowOf(rec),
      question: rec.question,
      ...(rec.options ? { options: rec.options } : {}),
      ...(rec.brief !== undefined ? { brief: rec.brief } : {}),
      ...(rec.briefLabel ? { briefLabel: rec.briefLabel } : {}),
      snapshot: rec.snapshot,
      answerable: rec.origin !== "file" && rec.claim === undefined,
      ...(rec.questions ? { questions: rec.questions } : {}),
    };
  }

  function claim(id: string): ClaimResult {
    const rec = byId.get(id);
    if (rec) {
      if (rec.claim) return { status: "answered" };
      rec.claim = "claimed";
      return { status: "claimed", id };
    }
    return answeredRecently(id) ? { status: "answered" } : { status: "unknown" };
  }

  return {
    onTracked(sessionId, msg) {
      const promptId = msg.promptId;
      if (typeof promptId !== "string" || !promptId) return undefined;
      const key = keyOf(sessionId, promptId);
      const existing = byKey.get(key);
      if (existing) return existing; // re-send: same id, nothing recomputed

      const prompt = (msg.prompt ?? {}) as { question?: unknown; type?: unknown; options?: unknown; metadata?: Record<string, unknown> };
      const metadata = prompt.metadata && typeof prompt.metadata === "object" ? prompt.metadata : undefined;
      const message = contextMessageOf(metadata?.message);
      const session = deps.describeSession(sessionId);
      const base = {
        sessionId,
        promptId,
        type: typeof prompt.type === "string" ? prompt.type : "unknown",
        question: typeof prompt.question === "string" ? prompt.question : "",
        ...(Array.isArray(prompt.options) ? { options: prompt.options.filter((o): o is string => typeof o === "string") } : {}),
        ...(Array.isArray(metadata?.questions) ? { questions: metadata!.questions as BatchQuestion[] } : {}),
        ...(originOf(msg, session) ? { origin: originOf(msg, session) } : {}),
        ...(message !== undefined ? { message } : {}),
      };

      const file = persisted.get(key);
      let rec: QuestionRecord;
      let needsGeneration = false;
      if (file) {
        // Rebind after a restart: id, snapshot, brief and the failed tombstone are reused.
        persisted.delete(key);
        rec = {
          ...base,
          id: file.id,
          askedAt: file.askedAt,
          snapshot: file.snapshot,
          briefStatus: file.briefStatus === "pending" ? "failed" : file.briefStatus, // interrupted attempt = the one attempt
          ...(file.brief !== undefined ? { brief: file.brief } : {}),
          ...(file.briefLabel ? { briefLabel: file.briefLabel } : {}),
        };
        if (file.briefStatus === "pending") persist(rec);
      } else {
        const snapshot = buildQuestionSnapshot({ eventStore: deps.eventStore, sessionId, ...(metadata ? { metadata } : {}) });
        const decision = decideBriefPolicy({ message: metadata?.message, ...deps.config() });
        rec = { ...base, id: newId(), askedAt: now(), snapshot, briefStatus: "pending" };
        if (decision.kind === "provided") {
          rec.briefStatus = "provided";
          rec.brief = decision.brief;
          rec.briefLabel = "provided";
        } else if (decision.kind === "disabled") {
          rec.briefStatus = "unavailable";
        } else if (rec.origin === "file") {
          rec.briefStatus = "unavailable"; // file-access prompts are read-only: never send them to a model
        } else {
          needsGeneration = true;
        }
        persist(rec);
      }
      byKey.set(key, rec);
      byId.set(rec.id, rec);
      emit({ kind: "added", id: rec.id, sessionId });
      if (needsGeneration) {
        runGeneration(rec, "auto").catch((err) => console.warn(`[questions] auto brief generation failed for ${rec.id}:`, (err as Error)?.message ?? err));
      }
      return rec;
    },

    removeQuestion(sessionId, promptId, _reason) {
      const key = keyOf(sessionId, promptId);
      dropPersisted(key);
      const rec = byKey.get(key);
      if (!rec) return false;
      dropRecord(rec, "removed");
      return true;
    },

    reconcileSession(sessionId, keepPromptIds) {
      const keep = new Set(keepPromptIds);
      for (const rec of [...byKey.values()]) {
        if (rec.sessionId === sessionId && !keep.has(rec.promptId)) dropRecord(rec, "removed");
      }
      for (const [key, file] of [...persisted]) {
        if (file.sessionId === sessionId && !keep.has(file.promptId)) dropPersisted(key);
      }
    },

    removeQuestionsForSession(sessionId, _reason) {
      for (const rec of [...byKey.values()]) if (rec.sessionId === sessionId) dropRecord(rec, "removed");
      for (const [key, file] of [...persisted]) if (file.sessionId === sessionId) dropPersisted(key);
    },

    get: (id) => byId.get(id),
    getDetail(id) {
      const rec = byId.get(id);
      return rec ? detailOf(rec) : undefined;
    },

    listRows(isVisible) {
      return [...byId.values()]
        .filter((r) => r.claim !== "transmitted" && (!isVisible || isVisible(r.sessionId)))
        .sort((a, b) => b.askedAt - a.askedAt)
        .map(rowOf);
    },

    lookup(id) {
      const rec = byId.get(id);
      if (rec) {
        if (rec.claim !== "transmitted") return { state: "open", record: rec };
        return now() - (rec.transmittedAt ?? 0) < TRANSMITTED_WINDOW_MS ? { state: "answered" } : { state: "unknown" };
      }
      return answeredRecently(id) ? { state: "answered" } : { state: "unknown" };
    },

    claim,
    claimPrompt(sessionId, promptId) {
      const rec = byKey.get(keyOf(sessionId, promptId));
      // File-access prompts keep their own approval road: never claimed here.
      return rec && rec.origin !== "file" ? claim(rec.id) : { status: "unknown" };
    },
    releaseClaim(id) {
      const rec = byId.get(id);
      if (rec?.claim === "claimed") rec.claim = undefined;
    },
    markTransmitted(id) {
      const rec = byId.get(id);
      if (!rec) return;
      rec.claim = "transmitted";
      rec.transmittedAt = now();
      sweepTombstones();
      tombstones.set(id, rec.transmittedAt);
      emit({ kind: "hidden", id, sessionId: rec.sessionId });
    },

    async summarize(id) {
      const rec = byId.get(id);
      if (!rec) return { ok: false, reason: "not-found", error: "question not found" };
      if (rec.origin === "file") return { ok: false, reason: "unavailable", error: "file-access prompts are not summarised" };
      if (rec.briefStatus === "ready" && rec.briefLabel !== "provided") {
        return { ok: false, reason: "already-generated", error: "brief is already generated" };
      }
      const outcome = await runGeneration(rec, "on-demand");
      if (outcome.ok) return { ok: true, detail: detailOf(rec) };
      return { ok: false, reason: outcome.kind, error: outcome.reason };
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    loadPersisted() {
      for (const file of deps.files.loadAll()) persisted.set(keyOf(file.sessionId, file.promptId), file);
    },
    sweepAtBoot(presence) {
      const deleted = deps.files.sweep(presence);
      const gone = new Set(deleted);
      for (const [key, file] of [...persisted]) if (gone.has(file.id)) persisted.delete(key);
      return deleted;
    },

    getStats() {
      sweepTombstones();
      return {
        open: [...byId.values()].filter((r) => r.claim !== "transmitted").length,
        hidden: [...byId.values()].filter((r) => r.claim === "transmitted").length,
        persistedUnbound: persisted.size,
        transmittedWindow: tombstones.size,
        briefs: deps.briefs.stats(),
      };
    },
  };
}
