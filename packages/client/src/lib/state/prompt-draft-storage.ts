/**
 * Per-prompt answer-draft store for interactive `ask_user` renderers
 * (select / multiselect / input / batch).
 *
 * Memory-first: a module-level `Map` is the live source of truth, written
 * synchronously on every edit and read on mount, so a surface mounted right
 * after another (chat card → dialog, session switch) never sees stale storage.
 * `sessionStorage` (per tab, NOT `localStorage`) mirrors each entry under
 * `ask-draft:<sessionId>:<promptId>` → `{ v: 1, savedAt, state }` for reload
 * survival; the mirror is debounced, flushed on unmount / `pagehide`, capped per
 * entry, and every storage failure is swallowed (the store degrades to
 * memory-only). Pasted images live in a separate memory-only `Map` (never
 * mirrored: base64 would blow the cap).
 *
 * Cleared by STATE (`deletePromptDraft`, driven by the App-level sweep when a
 * request leaves `pending`), never at the answer click, so a failed delivery
 * keeps the draft. See change: fix-input-state-consistency (#1117).
 */
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const PROMPT_DRAFT_KEY_PREFIX = "ask-draft:";
/** Mirror write delay; the literal the chat-draft effect uses (App.tsx), kept local. */
export const PROMPT_DRAFT_DEBOUNCE_MS = 300;
/** Per-entry cap: `JSON.stringify(entry).length` in UTF-16 code units, inclusive. */
export const PROMPT_DRAFT_MAX_ENTRY_UNITS = 16_384;
/** An entry strictly older than this is swept at hydrate. */
export const PROMPT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface DraftEntry {
  savedAt: number;
  state: unknown;
}

const memory = new Map<string, DraftEntry>();
/** baseKey → (step | -1) → images. Memory-only; the base key is the FULL draft key. */
const images = new Map<string, Map<number, ImageContent[]>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let hydrated = false;
let pagehideBound = false;

/** The full draft key. Both ids are required: no sessionId/promptId ⇒ no persistence. */
export function promptDraftKey(sessionId: string, promptId: string): string {
  return `${PROMPT_DRAFT_KEY_PREFIX}${sessionId}:${promptId}`;
}

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    return undefined; // SecurityError etc.: memory-only
  }
}

/** A well-formed, unexpired entry or undefined (never throws). */
function parseEntry(raw: string | null, now: number): DraftEntry | undefined {
  if (raw === null) return undefined;
  try {
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return undefined;
    const rec = obj as Record<string, unknown>;
    if (rec.v !== 1 || typeof rec.savedAt !== "number" || !("state" in rec)) return undefined;
    if (now - rec.savedAt > PROMPT_DRAFT_TTL_MS) return undefined;
    return { savedAt: rec.savedAt, state: rec.state };
  } catch {
    return undefined;
  }
}

function removeMirror(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

function writeMirror(key: string): void {
  const entry = memory.get(key);
  if (!entry) return; // never resurrect a cleared draft
  try {
    const store = storage();
    if (!store) return;
    const serialised = JSON.stringify({ v: 1, savedAt: entry.savedAt, state: entry.state });
    if (serialised.length > PROMPT_DRAFT_MAX_ENTRY_UNITS) {
      // Over the cap: keep the memory entry, drop any stale smaller mirror.
      store.removeItem(key);
      return;
    }
    store.setItem(key, serialised);
  } catch {
    // Quota / private mode / unserialisable: memory-only for this entry.
  }
}

/** Pull well-formed mirrors into memory; corrupt / expired ones are removed from storage and memory. */
function loadMirrors(now: number): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(PROMPT_DRAFT_KEY_PREFIX)) keys.push(k);
    }
    for (const key of keys) {
      const entry = parseEntry(store.getItem(key), now);
      if (!entry) {
        removeMirror(key);
        memory.delete(key);
      } else if (!memory.has(key)) {
        memory.set(key, entry);
      }
    }
  } catch {
    // unreadable storage: memory-only
  }
}

/**
 * Load every well-formed `ask-draft:*` mirror into memory and drop corrupt or
 * >24 h entries from storage and memory. Idempotent.
 */
export function hydratePromptDrafts(now: number = Date.now()): void {
  hydrated = true;
  loadMirrors(now);
  for (const [key, entry] of memory) {
    if (now - entry.savedAt > PROMPT_DRAFT_TTL_MS) {
      memory.delete(key);
      removeMirror(key);
    }
  }
}

function ensureHydrated(): void {
  if (!hydrated) hydratePromptDrafts();
}

function bindPagehide(): void {
  if (pagehideBound || typeof window === "undefined") return;
  pagehideBound = true;
  window.addEventListener("pagehide", flushAllPromptDrafts);
}

/** The stored (unvalidated) state for a prompt, or undefined. Memory first, then storage. */
export function getPromptDraft(sessionId: string, promptId: string): unknown {
  ensureHydrated();
  const key = promptDraftKey(sessionId, promptId);
  const hit = memory.get(key);
  if (hit) return hit.state;
  const store = storage();
  if (!store) return undefined;
  try {
    const raw = store.getItem(key);
    if (raw === null) return undefined;
    const entry = parseEntry(raw, Date.now());
    if (!entry) {
      removeMirror(key);
      return undefined;
    }
    memory.set(key, entry);
    return entry.state;
  } catch {
    return undefined;
  }
}

/** Record the draft in memory now; mirror to `sessionStorage` after the debounce. */
export function setPromptDraft(sessionId: string, promptId: string, state: unknown): void {
  ensureHydrated();
  bindPagehide();
  const key = promptDraftKey(sessionId, promptId);
  memory.set(key, { savedAt: Date.now(), state });
  const pending = timers.get(key);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      writeMirror(key);
    }, PROMPT_DRAFT_DEBOUNCE_MS),
  );
}

/** Write a pending (debounced) mirror now. No-op when nothing is pending or the draft was cleared. */
export function flushPromptDraft(sessionId: string, promptId: string): void {
  const key = promptDraftKey(sessionId, promptId);
  const pending = timers.get(key);
  if (pending === undefined) return;
  clearTimeout(pending);
  timers.delete(key);
  writeMirror(key);
}

function flushAllPromptDrafts(): void {
  for (const [key, timer] of [...timers]) {
    clearTimeout(timer);
    timers.delete(key);
    writeMirror(key);
  }
}

/** Remove a prompt's draft everywhere: memory, mirror, pending timer, and every image step. Idempotent. */
export function deletePromptDraft(sessionId: string, promptId: string): void {
  const key = promptDraftKey(sessionId, promptId);
  const pending = timers.get(key);
  if (pending !== undefined) clearTimeout(pending);
  timers.delete(key);
  memory.delete(key);
  images.delete(key);
  removeMirror(key);
}

/** True when anything is held for the prompt (so the sweep can skip prompts with no draft: no storage writes). */
export function hasPromptDraft(sessionId: string, promptId: string): boolean {
  ensureHydrated();
  const key = promptDraftKey(sessionId, promptId);
  return memory.has(key) || images.has(key) || timers.has(key);
}

/** Images pasted into a prompt step (`step` omitted ⇒ the standalone input prompt). Memory-only. */
export function getPromptDraftImages(sessionId: string, promptId: string, step = -1): ImageContent[] {
  return images.get(promptDraftKey(sessionId, promptId))?.get(step) ?? [];
}

export function setPromptDraftImages(sessionId: string, promptId: string, step: number, next: ImageContent[]): void {
  const key = promptDraftKey(sessionId, promptId);
  const steps = images.get(key) ?? new Map<number, ImageContent[]>();
  if (next.length === 0) steps.delete(step);
  else steps.set(step, next);
  if (steps.size === 0) images.delete(key);
  else images.set(key, steps);
}

/** Held-state counters (tests / soak checks). */
export function promptDraftStats(): { drafts: number; imageEntries: number; timers: number } {
  let imageEntries = 0;
  for (const steps of images.values()) imageEntries += steps.size;
  return { drafts: memory.size, imageEntries, timers: timers.size };
}

/**
 * Forget all in-memory state WITHOUT touching `sessionStorage` — models a page
 * reload for tests (the next read rehydrates from storage).
 */
export function resetPromptDraftMemory(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  memory.clear();
  images.clear();
  hydrated = false;
}
