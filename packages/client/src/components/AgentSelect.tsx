/**
 * AgentSelect — a labelled native select for choosing the agent a spawn will use
 * (pi + configured ACP agents), bound to the folder's remembered agent.
 *
 * Renders NOTHING when no ACP agent is configured, so every host surface is
 * unchanged for current users. Choosing updates the folder's memory (the same
 * memory the folder tray's split button reads).
 *
 * See change: add-acp-session-driver (D16: directory home, worktree dialog).
 */
import { useEffect, useRef, useState } from "react";
import { useAcpAgents } from "../hooks/useAcpAgents.js";
import { getRememberedAgent, rememberAgent } from "../lib/acp/agent-memory.js";
import { t as i18nT } from "../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  /** Notified with the effective agent id (`undefined` = pi), initially and on change. */
  onChange?: (agent: string | undefined) => void;
  testId?: string;
  className?: string;
}

export function AgentSelect({ cwd, onChange, testId = "agent-select", className }: Props) {
  const agents = useAcpAgents();
  const [value, setValue] = useState<string | undefined>(() => getRememberedAgent(cwd, agents));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Notify on (re)resolution only — a new `onChange` identity must not re-fire it.
  useEffect(() => {
    const next = getRememberedAgent(cwd, agents);
    setValue(next);
    onChangeRef.current?.(next);
  }, [cwd, agents]);

  if (agents.length === 0) return null;
  const id = `${testId}-input`;
  return (
    <div className={className ?? "flex items-center gap-2 text-xs"}>
      <label htmlFor={id} className="text-[var(--text-secondary)]">
        {i18nT("acp.agent", undefined, "Agent")}
      </label>
      <select
        id={id}
        data-testid={testId}
        value={value ?? ""}
        onChange={(e) => {
          const next = e.target.value || undefined;
          setValue(next);
          rememberAgent(cwd, next);
          onChange?.(next);
        }}
        className="focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-primary)] min-h-[44px] sm:min-h-0"
      >
        <option value="">pi</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
