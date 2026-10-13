/**
 * useAgentAwareSpawn — wraps a `handleSpawnSession`-shaped callback so a spawn
 * that did not name an agent uses the folder's REMEMBERED one (the choice made in
 * the folder tray / directory home). With no ACP agents configured, or a pi
 * memory, the wrapped call is byte-identical to the original.
 *
 * For entry points that have no picker UI of their own (OpenSpec board spawn,
 * landing-page quick spawn); the folder's split button owns the choice.
 *
 * See change: add-acp-session-driver (D16).
 */
import { useCallback } from "react";
import { getRememberedAgent } from "../lib/acp/agent-memory.js";
import { useAcpAgents } from "./useAcpAgents.js";

type SpawnOpts = { agent?: string; [k: string]: unknown };

export function useAgentAwareSpawn<A extends unknown[]>(
  spawn: ((cwd: string, attachProposal?: string, opts?: SpawnOpts, ...rest: A) => void) | undefined,
): ((cwd: string, attachProposal?: string, opts?: SpawnOpts, ...rest: A) => void) | undefined {
  const agents = useAcpAgents();
  const wrapped = useCallback(
    (cwd: string, attachProposal?: string, opts?: SpawnOpts, ...rest: A) => {
      const agent = opts?.agent ?? getRememberedAgent(cwd, agents);
      spawn?.(cwd, attachProposal, agent ? { ...opts, agent } : opts, ...rest);
    },
    [spawn, agents],
  );
  return spawn ? wrapped : undefined;
}
