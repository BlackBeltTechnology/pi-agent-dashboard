/**
 * Settings ▸ Sessions ▸ Session list ▸ "Default grouping" (ui-plan §8).
 * 3-segment `role="radiogroup"` (None / Status / Location); ←/→ move the
 * value. Instant-apply over WS (`set_default_group_by`) — server-owned and
 * shared across browsers, so it bypasses the Save-bar draft on purpose.
 * See change: session-list-group-by.
 */
import { GROUP_BY_MODES, type GroupByMode } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import type React from "react";
import { useId, useRef } from "react";
import { t } from "../../lib/i18n/i18n.js";
import { groupByModeLabel } from "../session/GroupByChip.js";

export function DefaultGroupingField({
  value,
  onChange,
  disabled,
}: {
  value: GroupByMode;
  onChange: (mode: GroupByMode) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const hintId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = GROUP_BY_MODES.length;
    const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    onChange(GROUP_BY_MODES[next]);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="settings-default-grouping">
      <span id={labelId} className="text-sm text-[var(--text-primary)]">
        {t("settings.defaultGrouping", undefined, "Default grouping")}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="grid max-w-xs grid-cols-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-0.5"
      >
        {GROUP_BY_MODES.map((mode, idx) => {
          const checked = mode === value;
          return (
            <button
              key={mode}
              ref={(el) => {
                refs.current[idx] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(mode)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              data-testid={`settings-default-grouping-${mode}`}
              className={`focus-ring rounded-md py-1 text-xs disabled:cursor-not-allowed ${
                checked
                  ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-[0_1px_2px_var(--shadow-card)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {groupByModeLabel(mode)}
            </button>
          );
        })}
      </div>
      <p id={hintId} className="text-xs text-[var(--text-tertiary)]">
        {t(
          "settings.defaultGroupingHint",
          undefined,
          "Applies to every folder that has no grouping of its own. Change a single folder from its folder menu.",
        )}
      </p>
    </div>
  );
}
