/**
 * useAcpAgents — the configured ACP agents as `{ id, name }` (never command /
 * args / env), from `GET /api/acp/agents`. Empty when none are configured, which
 * is what keeps every spawn control rendering exactly as before.
 *
 * Module-cached (agents change only with a config edit + reload); `refreshAcpAgents`
 * re-probes after a settings save. A failed probe reads as "no agents".
 *
 * See change: add-acp-session-driver (D16).
 */
import { useEffect, useState } from "react";
import type { AcpAgentInfo } from "../lib/acp/agent-memory.js";

let cached: AcpAgentInfo[] | null = null;
let inflight: Promise<AcpAgentInfo[]> | null = null;
const listeners = new Set<(a: AcpAgentInfo[]) => void>();

function parse(body: unknown): AcpAgentInfo[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((a) =>
    a && typeof a.id === "string" && typeof a.name === "string" ? [{ id: a.id, name: a.name }] : [],
  );
}

function refreshAcpAgents(): Promise<AcpAgentInfo[]> {
  inflight = (async () => {
    try {
      const res = await fetch("/api/acp/agents");
      cached = res.ok ? parse(await res.json()) : [];
    } catch {
      cached = [];
    }
    for (const l of listeners) l(cached);
    return cached;
  })();
  return inflight;
}

export function useAcpAgents(): AcpAgentInfo[] {
  const [agents, setAgents] = useState<AcpAgentInfo[]>(cached ?? []);
  useEffect(() => {
    listeners.add(setAgents);
    if (cached === null && inflight === null) void refreshAcpAgents();
    else if (cached) setAgents(cached);
    return () => {
      listeners.delete(setAgents);
    };
  }, []);
  return agents;
}

/** Test seam. */
export function _setAcpAgentsForTests(agents: AcpAgentInfo[] | null): void {
  cached = agents;
  inflight = agents === null ? null : Promise.resolve(agents);
  for (const l of listeners) l(agents ?? []);
}
