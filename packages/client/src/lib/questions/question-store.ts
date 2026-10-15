/**
 * Client store for the pending-question stack. The server sends
 * `questions_update` (a FULL replacement of this viewer's visible rows; first
 * frame on connect, possibly empty; removals immediate). `useMessageHandler`
 * calls `setQuestions`; the header pill + panel subscribe through
 * `useQuestionStack`. Rows are kept newest-first.
 * See change: add-pending-question-stack.
 */
import type { QuestionRow } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { useSyncExternalStore } from "react";

export interface QuestionStackSnapshot {
  /** Newest-first. */
  rows: readonly QuestionRow[];
  /** True once at least one `questions_update` frame has been applied. */
  loaded: boolean;
}

const EMPTY: QuestionStackSnapshot = { rows: [], loaded: false };

/** Newest first; equal timestamps keep server order (stable sort). */
function sortNewestFirst(rows: readonly QuestionRow[]): QuestionRow[] {
  return [...rows].sort((a, b) => b.askedAt - a.askedAt);
}

export class QuestionStackStore {
  private snap: QuestionStackSnapshot = EMPTY;
  private key = "";
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): QuestionStackSnapshot => this.snap;

  /** Replace all rows. Listeners fire only when something changed. */
  set = (rows: readonly QuestionRow[]): void => {
    const sorted = sortNewestFirst(rows);
    const key = JSON.stringify(sorted);
    if (this.snap.loaded && key === this.key) return;
    this.key = key;
    this.snap = { rows: sorted, loaded: true };
    for (const l of this.listeners) l();
  };

  /** Back to the never-loaded state (tests, server switch). */
  reset = (): void => {
    this.snap = EMPTY;
    this.key = "";
    for (const l of this.listeners) l();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export const questionStore = new QuestionStackStore();

/** Message-handler entry point for `questions_update`. */
export function setQuestions(rows: readonly QuestionRow[]): void {
  questionStore.set(rows);
}

export function useQuestionStack(store: QuestionStackStore = questionStore): QuestionStackSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
