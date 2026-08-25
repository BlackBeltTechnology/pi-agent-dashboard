/**
 * Composer grammar/spell-check hook. Fetches the non-secret grammar config
 * from `GET /api/grammar/health` once, then drives manual + debounced-auto
 * checks against `POST /api/grammar/check`, and owns offset-safe apply of
 * corrections back into the controlled composer draft.
 *
 * The draft is owned by the composer (via `draft` / `onDraftChange`); this
 * hook never stores draft text itself. Fetches are relative to the dashboard
 * origin (same-origin plugin). See changes: add-composer-grammar-check,
 * make-grammar-fully-plugin-contained.
 */

import type {
  GrammarCheckResult,
  GrammarCorrectionView,
  GrammarErrorCode,
  GrammarHealth,
  GrammarSuggestion,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GrammarStatus = "idle" | "checking" | "done" | "error";

/** A suggestion annotated with whether it still applies to the current draft. */
export interface ActiveSuggestion extends GrammarSuggestion {
  stale: boolean;
}

export interface UseGrammarCheck {
  enabled: boolean;
  /** Which corrections presentation the composer should render. */
  correctionView: GrammarCorrectionView;
  status: GrammarStatus;
  error: GrammarErrorCode | null;
  /** Corrections not yet applied/dismissed, annotated with staleness. */
  suggestions: ActiveSuggestion[];
  summary: string | null;
  truncated: boolean;
  /** Run a check on the current draft now (ignores the auto-check gate). */
  checkNow: () => void;
  /** Replace the draft with the fully-corrected text. */
  applyAll: () => void;
  /** Apply a single suggestion into the draft (offset-safe). */
  accept: (id: string) => void;
  /** Remove a suggestion from the panel without touching the draft. */
  dismiss: (id: string) => void;
  /** Hide the panel and clear all suggestions. */
  dismissPanel: () => void;
}

const DEFAULT_HEALTH: GrammarHealth = {
  enabled: false,
  backend: "llm",
  autoCheck: true,
  debounceMs: 1200,
  minChars: 12,
  language: "auto",
  correctionView: "redline",
};

/** Slash commands and `!`/`!!` shell inputs are not prose — never auto-checked. */
function isNonProse(draft: string): boolean {
  const t = draft.trimStart();
  return t.startsWith("/") || t.startsWith("!");
}

export interface UseGrammarCheckArgs {
  draft: string;
  sessionId: string | undefined;
  sessionStatus: "idle" | "streaming" | "ended" | undefined;
  onDraftChange: (text: string) => void;
}

export function useGrammarCheck(args: UseGrammarCheckArgs): UseGrammarCheck {
  const { draft, sessionId, sessionStatus, onDraftChange } = args;

  const [health, setHealth] = useState<GrammarHealth>(DEFAULT_HEALTH);
  const [status, setStatus] = useState<GrammarStatus>("idle");
  const [error, setError] = useState<GrammarErrorCode | null>(null);
  const [result, setResult] = useState<GrammarCheckResult | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // One-shot config fetch.
  useEffect(() => {
    let active = true;
    fetch("/api/grammar/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (active && body?.success && body.data) setHealth(body.data as GrammarHealth);
      })
      .catch(() => {
        /* feature stays disabled on failure */
      });
    return () => {
      active = false;
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setError(null);
    setResult(null);
    setDismissedIds(new Set());
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional session-switch-only reset; `sessionId` is the re-pulse trigger even though it is not read in the body.
  useEffect(() => {
    reset();
  }, [sessionId, reset]);

  // An empty composer has nothing to correct: clear the panel (and abort any
  // in-flight check) once the draft is blank. This is what fires after Send
  // (which resets the draft to "") so stale corrections don't linger, and it
  // also covers a manual clear. Guarded on `status` so it is a no-op — and
  // never loops — once already idle.
  useEffect(() => {
    if (status !== "idle" && draft.trim() === "") reset();
  }, [draft, status, reset]);

  const runCheck = useCallback(
    (text: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("checking");
      setError(null);
      fetch("/api/grammar/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
        .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
        .then(({ ok, body }) => {
          if (controller.signal.aborted) return;
          if (ok && body?.success && body.data) {
            setResult(body.data as GrammarCheckResult);
            setDismissedIds(new Set());
            setStatus("done");
          } else {
            setError((body?.code as GrammarErrorCode) ?? "backend_unreachable");
            setStatus("error");
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setError("backend_unreachable");
          setStatus("error");
        });
    },
    [],
  );

  const checkNow = useCallback(() => {
    if (!health.enabled) return;
    const text = draftRef.current;
    if (!text.trim()) return;
    runCheck(text);
  }, [health.enabled, runCheck]);

  // Debounced auto-check.
  useEffect(() => {
    if (!health.enabled || !health.autoCheck) return;
    if (draft.trim().length < health.minChars) return;
    if (sessionStatus === "streaming") return;
    if (isNonProse(draft)) return;
    // New keystroke: abort any in-flight check and (re)start the debounce.
    abortRef.current?.abort();
    const timer = setTimeout(() => runCheck(draft), health.debounceMs);
    return () => clearTimeout(timer);
  }, [draft, health.enabled, health.autoCheck, health.minChars, health.debounceMs, sessionStatus, runCheck]);

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  }, []);

  const dismissPanel = useCallback(() => {
    setResult(null);
    setStatus("idle");
    setError(null);
    setDismissedIds(new Set());
  }, []);

  const applyAll = useCallback(() => {
    if (!result) return;
    onDraftChange(result.correctedText);
    dismissPanel();
  }, [result, onDraftChange, dismissPanel]);

  const accept = useCallback(
    (id: string) => {
      if (!result) return;
      const s = result.suggestions.find((x) => x.id === id);
      if (!s) return;
      const text = draftRef.current;
      // Prefer the recorded offset; fall back to a forward search for `original`.
      const at =
        text.slice(s.offset, s.offset + s.length) === s.original ? s.offset : text.indexOf(s.original);
      if (at === -1) {
        // Stale — cannot locate the span; drop it rather than corrupt the draft.
        dismiss(id);
        return;
      }
      onDraftChange(text.slice(0, at) + s.replacement + text.slice(at + s.original.length));
      dismiss(id);
    },
    [result, onDraftChange, dismiss],
  );

  const suggestions = useMemo<ActiveSuggestion[]>(() => {
    if (!result) return [];
    return result.suggestions
      .filter((s) => !dismissedIds.has(s.id))
      .map((s) => ({ ...s, stale: !draft.includes(s.original) }));
  }, [result, dismissedIds, draft]);

  return {
    enabled: health.enabled,
    correctionView: health.correctionView,
    status,
    error,
    suggestions,
    summary: result?.summary ?? null,
    truncated: result?.truncated ?? false,
    checkNow,
    applyAll,
    accept,
    dismiss,
    dismissPanel,
  };
}
