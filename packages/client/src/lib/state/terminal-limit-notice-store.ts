/**
 * Module-singleton store for the "terminal limit reached" notice. One notice per
 * slot (`cwd` + inline flag): a second rejection REPLACES it, the next
 * successful spawn for that cwd clears it, and the user can dismiss it.
 * See change: harden-server-capability-bounds (D3).
 */
export interface TerminalLimitNotice {
  scope: "global" | "owner";
  limit: number;
  cwd: string;
  inline: boolean;
}

type Listener = () => void;
const notices = new Map<string, TerminalLimitNotice>();
const listeners = new Set<Listener>();
// `useSyncExternalStore` needs a stable snapshot per slot until it changes.
let version = 0;

const slot = (cwd: string, inline: boolean): string => `${inline ? "inline" : "tab"}\u0000${cwd}`;
const emit = (): void => {
  version++;
  for (const l of listeners) l();
};

export function showTerminalLimitNotice(n: TerminalLimitNotice): void {
  notices.set(slot(n.cwd, n.inline), { ...n });
  emit();
}

export function dismissTerminalLimitNotice(cwd: string, inline: boolean): void {
  if (notices.delete(slot(cwd, inline))) emit();
}

/** A terminal spawned for `cwd`: both slots for that cwd are stale. */
export function clearTerminalLimitNotices(cwd: string): void {
  const a = notices.delete(slot(cwd, false));
  const b = notices.delete(slot(cwd, true));
  if (a || b) emit();
}

export function getTerminalLimitNotice(cwd: string, inline: boolean): TerminalLimitNotice | undefined {
  return notices.get(slot(cwd, inline));
}

export function subscribeTerminalLimitNotices(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getTerminalLimitNoticeVersion = (): number => version;

export function __resetTerminalLimitNoticeForTests(): void {
  notices.clear();
  listeners.clear();
  version = 0;
}
