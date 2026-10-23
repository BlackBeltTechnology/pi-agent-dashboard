/**
 * Module-singleton store for the terminal notice: ONE notice at a time. A newer
 * terminal notice (a cap refusal `terminal_limit_reached` OR a cwd refusal
 * `terminal_error`) REPLACES the older one whatever its slot, the next successful
 * spawn clears what it made stale, and the user can dismiss it.
 *
 * Slot matching: a cap notice shows in the slot that asked (`cwd` + inline flag).
 * A `terminal_error` shows by inline flag only — the refused cwd is typically NOT a
 * folder any pane is open for, so a cwd match would never render it.
 * See change: harden-server-capability-bounds (D3), harden-git-terminal-plugin-boundaries (D14).
 */
export interface TerminalLimitNotice {
  kind: "limit";
  scope: "global" | "owner";
  limit: number;
  cwd: string;
  inline: boolean;
}

export interface TerminalErrorNotice {
  kind: "error";
  code: "cwd_not_admitted" | "cwd_admission_unavailable" | "session_not_found";
  /** Server-authored refusal text, rendered verbatim. */
  message: string;
  cwd: string;
  inline: boolean;
}

export type TerminalNotice = TerminalLimitNotice | TerminalErrorNotice;

/** Input shape for {@link showTerminalLimitNotice}: `kind` defaults to a cap notice. */
export type ShowTerminalNoticeInput = Omit<TerminalLimitNotice, "kind"> | TerminalErrorNotice;

type Listener = () => void;
let current: TerminalNotice | undefined;
const listeners = new Set<Listener>();
// `useSyncExternalStore` needs a stable snapshot until the store changes.
let version = 0;

const emit = (): void => {
  version++;
  for (const l of listeners) l();
};

const matches = (n: TerminalNotice, cwd: string, inline: boolean): boolean =>
  n.inline === inline && (n.kind === "error" || n.cwd === cwd);

/** Show `n`, replacing any earlier terminal notice. */
export function showTerminalLimitNotice(n: ShowTerminalNoticeInput): void {
  current = "kind" in n && n.kind === "error" ? { ...n } : { ...(n as Omit<TerminalLimitNotice, "kind">), kind: "limit" };
  emit();
}

export function dismissTerminalLimitNotice(cwd: string, inline: boolean): void {
  if (current && matches(current, cwd, inline)) {
    current = undefined;
    emit();
  }
}

/** A terminal spawned for `cwd`: that cwd's cap notice, and any refusal notice, are stale. */
export function clearTerminalLimitNotices(cwd: string): void {
  if (current && (current.kind === "error" || current.cwd === cwd)) {
    current = undefined;
    emit();
  }
}

export function getTerminalLimitNotice(cwd: string, inline: boolean): TerminalNotice | undefined {
  return current && matches(current, cwd, inline) ? current : undefined;
}

export function subscribeTerminalLimitNotices(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getTerminalLimitNoticeVersion = (): number => version;

export function __resetTerminalLimitNoticeForTests(): void {
  current = undefined;
  listeners.clear();
  version = 0;
}
