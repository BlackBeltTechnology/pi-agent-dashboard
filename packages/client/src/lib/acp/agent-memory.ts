/**
 * Per-folder remembered spawn agent (D16): the last agent chosen for a folder is
 * preselected next time. A remembered id that is no longer configured falls back
 * to pi (`undefined`). Pure localStorage helpers — tolerant of unavailable storage.
 *
 * See change: add-acp-session-driver (D16).
 */

export interface AcpAgentInfo {
  id: string;
  name: string;
  /** Not sent by the server today; reserved for menu meta when the projection grows. */
  durable?: boolean;
}

const KEY_PREFIX = "pi-dashboard:spawn-agent:";

export const agentMemoryKey = (cwd: string): string => `${KEY_PREFIX}${cwd}`;

/** The remembered agent id for `cwd` if it is still configured, else `undefined` (= pi). */
export function getRememberedAgent(cwd: string, agents: readonly AcpAgentInfo[]): string | undefined {
  try {
    const id = window.localStorage.getItem(agentMemoryKey(cwd));
    return id && agents.some((a) => a.id === id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Remember `agentId` for `cwd`; `undefined` (pi) clears the memory. */
export function rememberAgent(cwd: string, agentId: string | undefined): void {
  try {
    if (agentId) window.localStorage.setItem(agentMemoryKey(cwd), agentId);
    else window.localStorage.removeItem(agentMemoryKey(cwd));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}
