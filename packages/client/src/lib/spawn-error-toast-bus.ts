/**
 * App-level fallback channel for spawn_error events whose cwd has no
 * visible folder banner (off-screen, not pinned, not in any workspace,
 * no session at that cwd). `useMessageHandler` dispatches into this bus
 * whenever `isVisibleCwd(...)` returns false; the `<SpawnErrorToastHost>`
 * component mounted near the app root subscribes and renders.
 *
 * Lives outside the existing per-folder `Toast` channel because that one
 * is owned by `SessionList` and uses a 3 s default. This channel is
 * mounted at the top of the tree and uses a 10 s default per spec.
 *
 * See change: harden-worktree-spawn.
 */

export interface SpawnErrorToastEntry {
  id: number;
  cwd: string;
  message: string;
  /** Stable code echoed for de-duping retries. */
  requestId?: string;
}

type Listener = (entries: ReadonlyArray<SpawnErrorToastEntry>) => void;

let nextId = 1;
let entries: SpawnErrorToastEntry[] = [];
const listeners = new Set<Listener>();

/** Auto-dismiss timeout per entry; visible long enough to read + copy cwd. */
export const SPAWN_ERROR_TOAST_DURATION_MS = 10_000;

/** Truncate the message body to the spec-mandated <= 200 chars. */
function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

export interface PushSpawnErrorToastArgs {
  cwd: string;
  code: string;
  message: string;
  requestId?: string;
}

export function pushSpawnErrorToast(args: PushSpawnErrorToastArgs): void {
  // De-dupe by requestId: if a retry fires with the same id, drop the
  // prior entry so the user sees one toast for the current failure only.
  if (args.requestId) {
    entries = entries.filter((e) => e.requestId !== args.requestId);
  }
  const id = nextId++;
  const body = truncate(`Spawn failed at ${args.cwd}: ${args.code} \u2014 ${args.message}`);
  entries = [...entries, { id, cwd: args.cwd, message: body, requestId: args.requestId }];
  emit();
  setTimeout(() => dismissSpawnErrorToast(id), SPAWN_ERROR_TOAST_DURATION_MS);
}

export function dismissSpawnErrorToast(id: number): void {
  const next = entries.filter((e) => e.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  emit();
}

export function subscribeSpawnErrorToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(entries);
  return () => { listeners.delete(listener); };
}

function emit(): void {
  for (const l of listeners) {
    try { l(entries); } catch { /* swallow */ }
  }
}

export function __resetSpawnErrorToastBusForTests(): void {
  entries = [];
  listeners.clear();
  nextId = 1;
}
