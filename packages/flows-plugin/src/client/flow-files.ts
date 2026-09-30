/**
 * Client access to a session's flow files (flow YAML, agent `.md`, code-node
 * handlers) via the flows-plugin server (`/api/plugins/flows/file|files`, fed
 * by this plugin's bridge) — so files in runtime-registered flow dirs open —
 * falling back to the host `/api/pi-resource-file` (project `.pi/**`,
 * `~/.pi/agent/**`, `node_modules/**`). Never touches host core.
 * See change: attach-flow-before-run.
 */
import type { FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

const RETRY_MS = 1_200;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readJson(r: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function contentOf(json: Record<string, unknown> | null): string | null {
  const data = json?.data as { content?: unknown } | undefined;
  return json?.success && typeof data?.content === "string" ? data.content : null;
}

/** Read a flow-related file's content; throws `Error(message)` on failure. */
export async function fetchFlowFile(sessionId: string | undefined, filePath: string): Promise<string> {
  if (sessionId) {
    const url = `/api/plugins/flows/file?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(filePath)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(url);
        const json = await readJson(r);
        const content = contentOf(json);
        if (content !== null) return content;
        if (r.status !== 409 || !json?.retry) break;
        await wait(RETRY_MS);
      } catch {
        break; // network / plugin unavailable → host fallback
      }
    }
  }
  const r = await fetch(`/api/pi-resource-file?path=${encodeURIComponent(filePath)}`);
  const json = await readJson(r);
  const content = contentOf(json);
  if (content !== null) return content;
  throw new Error(typeof json?.error === "string" ? json.error : `HTTP ${r.status}`);
}

export interface FlowNodeFiles {
  /** agent name → absolute agent file. */
  agents: Record<string, string>;
  /** flow name → step id → absolute code handler file. */
  handlers: Record<string, Record<string, string>>;
}

/** The session's reported agent + handler file paths (null until known). */
export function useFlowNodeFiles(sessionId: string | undefined, enabled = true): FlowNodeFiles | null {
  const [files, setFiles] = useState<FlowNodeFiles | null>(null);
  useEffect(() => {
    setFiles(null);
    if (!sessionId || !enabled) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          const r = await fetch(`/api/plugins/flows/files?sessionId=${encodeURIComponent(sessionId)}`);
          const json = await readJson(r);
          const data = json?.data as ({ reported?: unknown } & Partial<FlowNodeFiles>) | undefined;
          if (!json?.success || !data) return;
          if (data.reported === true) {
            if (!cancelled) setFiles({ agents: data.agents ?? {}, handlers: data.handlers ?? {} });
            return;
          }
        } catch {
          return;
        }
        await wait(RETRY_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled]);
  return files;
}

/**
 * Fill `sourcePath` (agent file) and `codeTarget` (handler file) on cards that
 * do not carry them yet — idle cards never do, live cards only after
 * `flow_agent_started`. Existing values are never overridden. Returns the SAME
 * state when nothing changes.
 */
export function withNodeFiles(state: FlowState, files: FlowNodeFiles | null): FlowState {
  if (!files) return state;
  const handlers = files.handlers[state.flowName] ?? {};
  const steps = new Map((state.dagSteps ?? []).map((d) => [d.id, d]));
  let agents: FlowState["agents"] | undefined;
  for (const [key, a] of state.agents) {
    const stepId = a.stepId || key;
    const agentName = steps.get(stepId)?.agent ?? (a.nodeKind === "code" || a.nodeKind === "code-decision" ? undefined : a.agentName);
    const sourcePath = a.sourcePath ?? (agentName ? files.agents[agentName] : undefined);
    const codeTarget = a.codeTarget ?? handlers[stepId];
    if (sourcePath === a.sourcePath && codeTarget === a.codeTarget) continue;
    agents ??= new Map(state.agents);
    agents.set(key, { ...a, sourcePath, codeTarget });
  }
  return agents ? { ...state, agents } : state;
}

/**
 * Open a file in the host's built-in editor (Monaco, Split view) via its
 * `/session/:id/editor?file=<path>` deep link — the same in-app route the
 * host's own file links use. `null` without a session (no editor to target).
 *
 * Every call stamps a fresh `openNonce` into the history entry's state. The URL
 * is byte-identical for the same file, so after the user closes the editor
 * (pane close control, or just the file's tab) a second click would otherwise
 * be indistinguishable from the re-render that follows the close — the host's
 * apply-once key would not change and the split would never come back. The host
 * folds the nonce into that key, so a deliberate open re-applies while a
 * re-render at the same nonce stays a no-op. The nonce stays out of the URL, so
 * a copied deep link is unchanged. See change: consolidate-flow-agent-cards (D8).
 *
 * The nonce must be unique across page loads: `history.state` survives a
 * reload, but this module's counter restarts, so a bare counter would re-mint a
 * value that already sits in the surviving entry (open file → nonce 1 → reload
 * → close → click = nonce 1 again) and the swallowed open would recur. Hence a
 * timestamp prefix plus the counter, as a string (the host accepts
 * number|string).
 */
let openNonceSeq = 0;

const nextOpenNonce = (): string => `${Date.now().toString(36)}-${(++openNonceSeq).toString(36)}`;

export function useOpenFileInEditor(sessionId: string | undefined): ((filePath: string) => void) | null {
  const [, navigate] = useLocation();
  const open = useCallback(
    (filePath: string) => {
      if (sessionId)
        navigate(`/session/${encodeURIComponent(sessionId)}/editor?file=${encodeURIComponent(filePath)}`, {
          state: { openNonce: nextOpenNonce() },
        });
    },
    [navigate, sessionId],
  );
  return sessionId ? open : null;
}
