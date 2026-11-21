/**
 * Prompt-answer draft hooks for the interactive renderers.
 *
 * `usePromptDraft` reads the stored draft ONCE per (sessionId, promptId) and
 * validates it (a corrupt / stale-shaped draft is discarded). `usePromptDraftSync`
 * mirrors the renderer's state back into the store, but only once it differs
 * from what the renderer started with — a surface that never edited never
 * writes. With either id missing (an id-less prompt, or a renderer mounted
 * without a `sessionId`) both hooks are inert, so nothing is persisted or
 * restored and no shared `ask-draft:<session>:undefined` bucket can form.
 * See change: fix-input-state-consistency (#1117).
 */
import { useEffect, useMemo, useRef } from "react";
import {
  deletePromptDraft,
  flushPromptDraft,
  getPromptDraft,
  setPromptDraft,
} from "../lib/state/prompt-draft-storage.js";

export function usePromptDraft<S>(
  sessionId: string | undefined,
  promptId: string | undefined,
  validate: (raw: unknown) => S | undefined,
): S | undefined {
  const validateRef = useRef(validate);
  validateRef.current = validate;
  return useMemo(() => {
    if (!sessionId || !promptId) return undefined;
    const raw = getPromptDraft(sessionId, promptId);
    if (raw === undefined) return undefined;
    const ok = validateRef.current(raw);
    if (ok === undefined) deletePromptDraft(sessionId, promptId); // corrupt / stale shape
    return ok;
  }, [sessionId, promptId]);
}

export function usePromptDraftSync<S>(sessionId: string | undefined, promptId: string | undefined, state: S): void {
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!sessionId || !promptId) return;
    const serialised = JSON.stringify(state);
    if (last.current === undefined) {
      last.current = serialised; // baseline: the state the renderer started with
      return;
    }
    if (serialised === last.current) return;
    last.current = serialised;
    setPromptDraft(sessionId, promptId, state);
  }, [sessionId, promptId, state]);
  useEffect(
    () => () => {
      if (sessionId && promptId) flushPromptDraft(sessionId, promptId);
    },
    [sessionId, promptId],
  );
}
