/**
 * Settings ▸ Security ▸ Agent file access — the operator switch of the agent path
 * gate (ask before the agent's read/write/edit tools leave their workspace).
 *
 * Contracts:
 * - Edits the panel DRAFT through callbacks; the panel Save persists it (a side
 *   `PUT` would be clobbered by the next Save).
 * - Under `PI_DASHBOARD_AGENT_PATH_GATE` the toggle is inert and says why.
 * - Honest copy: this is an approval prompt, NOT a sandbox — `bash` and custom
 *   tools are not covered.
 *
 * See change: ask-agent-file-access-in-chat.
 */
import { useI18n } from "../../lib/i18n/i18n.js";

export interface AgentPathGateDraft {
  enabled: boolean;
  timeoutSeconds: number;
}

export function AgentPathGateSection({
  value,
  envOverride,
  onChange,
}: {
  value: AgentPathGateDraft;
  /** `PI_DASHBOARD_AGENT_PATH_GATE` as the server sees it, or null. */
  envOverride: "on" | "off" | null;
  onChange: (next: AgentPathGateDraft) => void;
}) {
  const { t } = useI18n();
  const locked = envOverride !== null;
  const effective = envOverride ? envOverride === "on" : value.enabled;
  return (
    <section data-testid="agent-path-gate-section" className="mb-6">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
        {t("settings.agentPathGate", undefined, "Agent file access")}
      </h3>
      <p className="text-xs text-[var(--text-tertiary)] mb-3 max-w-[64ch]">
        {t(
          "settings.agentPathGateBody",
          undefined,
          "Ask before the agent reads, writes or edits files outside its workspace. This is an approval prompt, not a sandbox: shell commands and custom tools are not covered.",
        )}
      </p>
      <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          data-testid="agent-path-gate-enabled"
          checked={effective}
          disabled={locked}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        {t("settings.agentPathGateEnabled", undefined, "Ask before out-of-workspace file access")}
      </label>
      {locked && (
        <p data-testid="agent-path-gate-locked" className="text-xs text-[var(--severity-warning-fg)] mt-1">
          {t(
            "settings.agentPathGateLocked",
            { value: envOverride },
            "Set to {value} by PI_DASHBOARD_AGENT_PATH_GATE; unset it to change this here.",
          )}
        </p>
      )}
      <div className="mt-3">
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor="agent-path-gate-timeout">
          {t("settings.agentPathGateTimeout", undefined, "Answer within (seconds)")}
        </label>
        <input
          id="agent-path-gate-timeout"
          data-testid="agent-path-gate-timeout"
          type="number"
          min={5}
          max={3600}
          className="w-28 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
          value={value.timeoutSeconds}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n > 0) onChange({ ...value, timeoutSeconds: Math.round(n) });
          }}
        />
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          {t(
            "settings.agentPathGateTimeoutHint",
            undefined,
            "No answer in time denies the access (the agent is told why).",
          )}
        </p>
      </div>
    </section>
  );
}
