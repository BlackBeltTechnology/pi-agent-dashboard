/** Shared fixtures for the question-stack tests. See change: add-pending-question-stack. */
import type { QuestionDetail, QuestionRow } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const NOW = 1_700_000_000_000;

export function row(over: Partial<QuestionRow> & { id: string }): QuestionRow {
  return {
    sessionId: `s-${over.id}`,
    sessionLabel: `Session ${over.id}`,
    preview: `Question ${over.id}?`,
    type: "select",
    askedAt: NOW - 60_000,
    briefStatus: "ready",
    ...over,
  };
}

export function rows(n: number): QuestionRow[] {
  return Array.from({ length: n }, (_, i) => row({ id: `q${i + 1}`, askedAt: NOW - (n - i) * 60_000 }));
}

export function session(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return { id, cwd: "/repo", source: "tui", status: "active", startedAt: NOW, tokensIn: 0, tokensOut: 0, cost: 0, ...over } as DashboardSession;
}

export function detail(over: Partial<QuestionDetail> & { id: string }): QuestionDetail {
  return {
    ...row({ id: over.id }),
    question: "Resume or hand back?",
    options: ["Resume", "Hand back"],
    brief: "The agent is migrating the schema and needs a go/no-go.",
    briefLabel: "provided",
    briefStatus: "provided",
    snapshot: { toolCalls: [], redactionVersion: 1, assistantText: "Migration finished." },
    answerable: true,
    ...over,
  };
}

export function mockReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduce : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}
