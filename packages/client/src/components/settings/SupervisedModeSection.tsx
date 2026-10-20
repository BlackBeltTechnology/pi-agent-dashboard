/**
 * Settings ▸ Security ▸ Tool approval (Supervised mode) — machine-wide defaults for the
 * per-session Supervised mode: the mode new sessions start in, the approval timeout, and
 * the editable risky-tool set. There is deliberately NO allow-list field (design D2).
 *
 * Contracts:
 * - Edits the panel DRAFT through callbacks; the panel Save persists it.
 * - Timeout accepts a whole number 10–3600. Anything else shows a field error, never reaches
 *   the draft, and is reported through `onInvalidChange` so the panel disables Save.
 * - Warns when the ask_user (bus) timeout undercuts the approval timeout, stating the
 *   effective value `min(supervised, askUser − 1)` (design D10).
 * - Honest copy: approval, not a sandbox; allow-first gap named (design D2, task 7.1).
 *
 * See change: add-supervised-tool-approval (design D2, D10; mockup c-*).
 */
import type { SupervisedModeConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useId, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";

/** Mirrors `SUPERVISED_TIMEOUT_{MIN,MAX}_SECONDS` in shared config (the client cannot import its node-only runtime). */
const TIMEOUT_MIN = 10;
const TIMEOUT_MAX = 3600;

/** A whole number of seconds in [10, 3600], else null. */
export function parseSupervisedTimeout(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= TIMEOUT_MIN && n <= TIMEOUT_MAX ? n : null;
}

/**
 * Effective approval deadline in seconds: `max(1, min(supervised, askUser − 1))`. An ask_user
 * timeout ≤ 0 means "wait forever" (no undercut). Returns null when nothing undercuts.
 */
export function undercutEffectiveSeconds(supervisedSeconds: number, askUserSeconds: number): number | null {
  if (!(askUserSeconds > 0)) return null;
  const effective = Math.max(1, Math.min(supervisedSeconds, askUserSeconds - 1));
  return effective < supervisedSeconds ? effective : null;
}

export function SupervisedModeSection({
  value,
  askUserTimeoutSeconds,
  onChange,
  onInvalidChange,
}: {
  value: SupervisedModeConfig;
  /** The effective `askUserPromptTimeoutSeconds` (≤ 0 = wait forever). */
  askUserTimeoutSeconds: number;
  onChange: (next: SupervisedModeConfig) => void;
  /** Reports whether a field currently holds a refused value (disables panel Save). */
  onInvalidChange: (invalid: boolean) => void;
}) {
  const { t } = useI18n();
  const ids = { mode: useId(), timeout: useId(), tools: useId(), add: useId() };
  const [timeoutText, setTimeoutText] = useState(String(value.timeoutSeconds));
  const [addText, setAddText] = useState("");
  const timeoutInvalid = parseSupervisedTimeout(timeoutText) === null;

  // Re-sync the field when the draft changes underneath it (Discard / reload).
  useEffect(() => {
    setTimeoutText((cur) => (parseSupervisedTimeout(cur) === value.timeoutSeconds ? cur : String(value.timeoutSeconds)));
  }, [value.timeoutSeconds]);

  useEffect(() => {
    onInvalidChange(timeoutInvalid);
  }, [timeoutInvalid, onInvalidChange]);
  // The section unmounts when the operator leaves the tab: never leave Save stuck disabled.
  useEffect(() => () => onInvalidChange(false), [onInvalidChange]);

  const effective = timeoutInvalid ? null : undercutEffectiveSeconds(value.timeoutSeconds, askUserTimeoutSeconds);

  const addTool = () => {
    const name = addText.trim();
    if (!name) return;
    if (!value.tools.some((x) => x.toLowerCase() === name.toLowerCase())) onChange({ ...value, tools: [...value.tools, name] });
    setAddText("");
  };

  const input =
    "bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]";

  return (
    <section data-testid="supervised-mode-section" className="mb-6">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
        {t("settings.supervised.title", undefined, "Tool approval (Supervised mode)")}
      </h3>
      <p className="text-xs text-[var(--text-tertiary)] mb-3 max-w-[64ch]">
        {t(
          "settings.supervised.body",
          undefined,
          "In a Supervised session you approve each action the agent takes with the listed tools. This is approval, not a sandbox: an approved command can do anything your user account can, your own ! commands and anything an extension starts on its own never ask, and YOLO never answers these approvals. An extension loaded later can still change an approved tool's input. For real isolation, run the session in a container (Docker).",
        )}
      </p>

      <div className="mb-3">
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor={ids.mode}>
          {t("settings.supervised.default", undefined, "New sessions start in")}
        </label>
        <select
          id={ids.mode}
          data-testid="supervised-default-mode"
          className={input}
          value={value.default}
          onChange={(e) => onChange({ ...value, default: e.target.value === "supervised" ? "supervised" : "full" })}
        >
          <option value="full">{t("settings.supervised.defaultFull", undefined, "Full access (default)")}</option>
          <option value="supervised">{t("settings.supervised.defaultSupervised", undefined, "Supervised")}</option>
        </select>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-[64ch]">
          {t(
            "settings.supervised.defaultHint",
            undefined,
            "Each session can switch on its own from the composer. Sessions started by the chat gateway follow its tool policy instead.",
          )}
        </p>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1" htmlFor={ids.timeout}>
          {t("settings.supervised.timeout", undefined, "Approval timeout (seconds)")}
        </label>
        <input
          id={ids.timeout}
          data-testid="supervised-timeout"
          type="number"
          min={TIMEOUT_MIN}
          max={TIMEOUT_MAX}
          aria-invalid={timeoutInvalid}
          aria-describedby={timeoutInvalid ? `${ids.timeout}-error` : undefined}
          className={`w-28 text-right ${input} ${timeoutInvalid ? "!border-[var(--severity-error-fg)] text-[var(--severity-error-fg)]" : ""}`}
          value={timeoutText}
          onChange={(e) => {
            setTimeoutText(e.target.value);
            const n = parseSupervisedTimeout(e.target.value);
            if (n !== null && n !== value.timeoutSeconds) onChange({ ...value, timeoutSeconds: n });
          }}
        />
        {timeoutInvalid && (
          <p id={`${ids.timeout}-error`} data-testid="supervised-timeout-error" className="text-xs text-[var(--severity-error-fg)] mt-1 max-w-[64ch]">
            {t(
              "settings.supervised.timeoutInvalid",
              { min: TIMEOUT_MIN, max: TIMEOUT_MAX },
              "Must be a whole number from {min} to {max}. An unanswered approval is always denied, so there is no \"wait forever\".",
            )}
          </p>
        )}
        <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-[64ch]">
          {t(
            "settings.supervised.timeoutHint",
            undefined,
            "How long an approval waits before the tool call is denied. Default: 120 (2 min).",
          )}
        </p>
        {effective !== null && (
          <p data-testid="supervised-timeout-undercut" className="text-xs text-[var(--severity-warning-fg)] mt-1 max-w-[64ch]">
            {t(
              "settings.supervised.timeoutUndercut",
              { askUser: askUserTimeoutSeconds, effective },
              "The ask_user prompt timeout is {askUser} s, shorter than this approval timeout. Approvals are denied after the effective {effective} s instead.",
            )}
          </p>
        )}
      </div>

      <div>
        <span id={ids.tools} className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
          {t("settings.supervised.tools", undefined, "Tools that need approval")}
        </span>
        <ul aria-labelledby={ids.tools} data-testid="supervised-tools" className="flex flex-wrap items-center gap-1.5 m-0 p-0 list-none">
          {value.tools.map((tool) => (
            <li
              key={tool}
              data-testid="supervised-tool-chip"
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] font-mono text-xs text-[var(--text-primary)]"
            >
              {tool}
              <button
                type="button"
                aria-label={t("settings.supervised.removeTool", { tool }, "Stop asking for {tool}")}
                onClick={() => onChange({ ...value, tools: value.tools.filter((x) => x !== tool) })}
                className="focus-ring inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <Icon path={mdiClose} size={0.5} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 mt-2">
          <input
            id={ids.add}
            data-testid="supervised-tool-add"
            type="text"
            value={addText}
            placeholder={t("settings.supervised.addPlaceholder", undefined, "Add tool name")}
            aria-label={t("settings.supervised.addPlaceholder", undefined, "Add tool name")}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addTool();
              }
            }}
            className={`w-48 ${input}`}
          />
          <button
            type="button"
            data-testid="supervised-tool-add-button"
            disabled={addText.trim() === ""}
            onClick={addTool}
            className="focus-ring px-3 py-1 rounded text-sm border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            {t("settings.supervised.add", undefined, "Add")}
          </button>
        </div>
        {value.tools.length === 0 && (
          <p data-testid="supervised-tools-empty" className="text-xs text-[var(--severity-warning-fg)] mt-1 max-w-[64ch]">
            {t("settings.supervised.toolsEmpty", undefined, "No tools listed: Supervised sessions will not ask about anything.")}
          </p>
        )}
        <p className="text-xs text-[var(--text-tertiary)] mt-1 max-w-[64ch]" data-testid="supervised-allow-first-hint">
          {t(
            "settings.supervised.toolsHint",
            undefined,
            "Only these tools ask. Any other tool, including MCP and plugin tools, runs without asking until you add it here, for example context-mode's ctx_execute, which can run commands. Matching ignores case.",
          )}
        </p>
      </div>
    </section>
  );
}
