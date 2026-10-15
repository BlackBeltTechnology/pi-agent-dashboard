/**
 * Composition root for the pending-question stack: wires the question store to
 * the event store (snapshot source), the session manager (labels, change name,
 * chat-gateway marker), the durable file store, the `@fast` brief generator
 * and the live `questions` config. Keeps `server.ts` to one call.
 * See change: add-pending-question-stack.
 */
import path from "node:path";
import type { QuestionsConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { EventStore } from "../persistence/memory-event-store.js";
import { createBriefGenerator, type BriefGenerator } from "./brief-generator.js";
import { completeBrief, resolveBriefModel } from "./brief-runtime.js";
import { createQuestionFileStore, type QuestionFileStore, type SessionPresence } from "./question-files.js";
import { createQuestionStore, type QuestionStore, type SessionDescriptor } from "./question-store.js";

export interface QuestionStackDeps {
  eventStore: Pick<EventStore, "getMaxSeq" | "getEventsEndingAt">;
  sessionManager: { get(sessionId: string): DashboardSession | undefined };
  /** Live read (Settings changes apply without restart). */
  getConfig: () => QuestionsConfig;
  /** Test seams. */
  files?: QuestionFileStore;
  generator?: BriefGenerator;
}

function describeSessionFor(session: DashboardSession | undefined, sessionId: string): SessionDescriptor {
  if (!session) return { label: sessionId };
  const change = session.openspecChange ?? session.attachedProposal;
  const chatGateway = Object.values(session.pluginRefs ?? {}).some((ref) => ref?.kind === "chat-gateway");
  return {
    label: session.name || (session.cwd ? path.basename(session.cwd) : "") || sessionId,
    ...(change ? { changeName: change } : {}),
    ...(chatGateway ? { chatGateway: true } : {}),
  };
}

/**
 * Boot presence from the PRE-normalization scan record: cold start forces every
 * restored session to `ended` in memory, so the in-memory status cannot tell a
 * live headless session awaiting its bridge from one that really ended.
 */
export function persistedPresence(session: { status?: string; live?: boolean }): SessionPresence {
  return session.status === "ended" && session.live !== true ? "ended" : "present";
}

export function createQuestionStack(deps: QuestionStackDeps): { store: QuestionStore; generator: BriefGenerator } {
  const generator = deps.generator ?? createBriefGenerator({ resolveModel: resolveBriefModel, complete: completeBrief });
  const store = createQuestionStore({
    eventStore: deps.eventStore,
    files: deps.files ?? createQuestionFileStore(),
    describeSession: (sessionId) => describeSessionFor(deps.sessionManager.get(sessionId), sessionId),
    briefs: generator,
    config: deps.getConfig,
  });
  return { store, generator };
}
