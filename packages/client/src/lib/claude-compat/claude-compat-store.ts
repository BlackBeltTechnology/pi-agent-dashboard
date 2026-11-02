/**
 * Client store for the global Claude subscription compat switch.
 *
 * One module-level value shared by every surface (sign-in prompt, anthropic
 * row, Landing Step ①). `set()` is optimistic: subscribers see the new value
 * at once; a failed save reverts it and resolves `false` so the caller shows
 * its error toast.
 *
 * See change: retire-anthropic-messages-bridge.
 */
import { useSyncExternalStore } from "react";
import { getApiBase } from "../api/api-context.js";

const URL_PATH = "/api/preferences/claude-subscription-compat";

export interface ClaudeCompatSnapshot {
  /** `null` until a read succeeds. */
  value: boolean | null;
}

let snapshot: ClaudeCompatSnapshot = { value: null };
const listeners = new Set<() => void>();
let writeSeq = 0;

function publish(value: boolean | null): void {
  if (snapshot.value === value) return;
  snapshot = { value };
  for (const l of listeners) l();
}

/** Live read from the server. Resolves the value, or `null` when unreadable (state unchanged). */
async function read(): Promise<boolean | null> {
  try {
    const res = await fetch(`${getApiBase()}${URL_PATH}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { claudeSubscriptionCompat?: unknown };
    if (typeof body.claudeSubscriptionCompat !== "boolean") return null;
    publish(body.claudeSubscriptionCompat);
    return body.claudeSubscriptionCompat;
  } catch {
    return null;
  }
}

/** Optimistic write. Resolves `true` when saved; on failure reverts and resolves `false`. */
async function set(next: boolean): Promise<boolean> {
  const previous = snapshot.value;
  const seq = ++writeSeq;
  publish(next);
  try {
    const res = await fetch(`${getApiBase()}${URL_PATH}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: next }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { claudeSubscriptionCompat?: unknown };
    if (seq === writeSeq && typeof body.claudeSubscriptionCompat === "boolean") publish(body.claudeSubscriptionCompat);
    return true;
  } catch {
    if (seq === writeSeq) publish(previous);
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ClaudeCompatSnapshot {
  return snapshot;
}

export const claudeCompatStore = {
  read,
  set,
  subscribe,
  getSnapshot,
  /** Test-only: drop state and subscribers. */
  __resetForTests(): void {
    snapshot = { value: null };
    listeners.clear();
    writeSeq = 0;
  },
  /** Test-only: seed a known value without a request. */
  __setForTests(value: boolean | null): void {
    publish(value);
  },
} as const;

/** Subscribe to the switch value (`null` = not read yet). */
export function useClaudeCompat(): ClaudeCompatSnapshot {
  return useSyncExternalStore(claudeCompatStore.subscribe, claudeCompatStore.getSnapshot);
}
