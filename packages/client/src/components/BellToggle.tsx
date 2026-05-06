import React from "react";
import { Icon } from "@mdi/react";
import { mdiBellOutline, mdiBell, mdiRobotOutline } from "@mdi/js";

interface Props {
  /** Current bell state */
  state: "off" | "on" | "auto";
  /** Called on click — cycles to next state */
  onClick: () => void;
}

const ICON_MAP = {
  off: mdiBellOutline,
  on: mdiBell,
  auto: mdiRobotOutline,
} as const;

const COLOR_MAP = {
  off: "var(--text-secondary)",
  on: "var(--accent-primary, #3b82f6)",
  auto: "var(--accent-primary, #3b82f6)",
} as const;

const TOOLTIP_MAP = {
  off: "Push: off — no completion notification",
  on: "Push: on — notify on completion",
  auto: "Push: auto — agent decides when to notify",
} as const;

export function BellToggle({ state, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="p-0.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
      title={TOOLTIP_MAP[state]}
      aria-label={TOOLTIP_MAP[state]}
    >
      <Icon path={ICON_MAP[state]} size={0.5} color={COLOR_MAP[state]} />
    </button>
  );
}
