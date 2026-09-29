/**
 * Shared stop control for running tool calls in the chat view.
 *
 * `useToolStopState` owns the idle → arming → aborting → killing state machine
 * (one instance per burst, shared by header + running rows); `ToolStopControl`
 * renders it as a real `<button>` sibling of a toggle, never nested inside one.
 * The 600 ms arming window keeps an accidental double-click from force-killing.
 * See change: fix-chat-burst-tool-stop.
 */

import { mdiAlert, mdiLoading, mdiStop, mdiTimerSand } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export const FORCE_STOP_ARM_MS = 600;

export type ToolStopState = "idle" | "arming" | "aborting" | "killing";

export interface StopController {
  state: ToolStopState;
  stop: () => void;
  forceKill: () => void;
}

export function useToolStopState({
  active,
  runKey,
  onAbort,
  onForceKill,
}: {
  active: boolean;
  /** Identity of the running call; a change (handoff to a new call) resets to idle. */
  runKey?: string;
  onAbort?: () => void;
  onForceKill?: () => void;
}): StopController | null {
  const [state, setState] = useState<ToolStopState>("idle");
  // Ref mirrors state so guards hold across same-tick double events.
  const stateRef = useRef<ToolStopState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((s: ToolStopState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset when the tool stops running or a different call takes over; drop any
  // pending arm timer. `runKey` in deps covers a same-render complete→start handoff.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runKey is a reset trigger
  useEffect(() => {
    clearTimer();
    set("idle");
  }, [active, runKey, clearTimer, set]);

  useEffect(() => clearTimer, [clearTimer]);

  const stop = useCallback(() => {
    if (stateRef.current !== "idle" || !onAbort) return;
    onAbort();
    if (!onForceKill) return;
    set("arming");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (stateRef.current === "arming") set("aborting");
    }, FORCE_STOP_ARM_MS);
  }, [onAbort, onForceKill, set]);

  const forceKill = useCallback(() => {
    if (stateRef.current !== "aborting" || !onForceKill) return;
    onForceKill();
    set("killing");
  }, [onForceKill, set]);

  if (!active || !onAbort) return null;
  return { state, stop, forceKill };
}

interface StateSpec {
  suffix: string;
  icon: string;
  label: () => string;
  aria: () => string;
  tone: string;
  disabled: boolean;
  spin?: boolean;
}

const NEUTRAL =
  "text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] border-[var(--border-secondary)] cursor-not-allowed";

const SPECS: Record<ToolStopState, StateSpec> = {
  idle: {
    suffix: "stop-button",
    icon: mdiStop,
    label: () => i18nT("common.stop", undefined, "Stop"),
    aria: () => i18nT("common.stop", undefined, "Stop"),
    tone: "text-[var(--severity-error-fg)] border-[var(--severity-error-border)] hover:bg-[var(--severity-error-bg)]",
    disabled: false,
  },
  arming: {
    suffix: "arming-button",
    icon: mdiTimerSand,
    label: () => i18nT("common.stopping", undefined, "Stopping…"),
    aria: () => i18nT("common.stopping", undefined, "Stopping…"),
    tone: NEUTRAL,
    disabled: true,
  },
  aborting: {
    suffix: "force-stop-button",
    icon: mdiAlert,
    label: () => i18nT("common.forceStopShort", undefined, "Force stop"),
    aria: () => i18nT("common.forceStopKillTheProcess", undefined, "Force Stop — kill the process"),
    tone: "text-[var(--severity-warning-fg)] bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] animate-pulse motion-reduce:animate-none",
    disabled: false,
  },
  killing: {
    suffix: "killing-button",
    icon: mdiLoading,
    label: () => i18nT("common.killingShort", undefined, "Killing…"),
    aria: () => i18nT("command.killing", undefined, "Killing process..."),
    tone: NEUTRAL,
    disabled: true,
    spin: true,
  },
};

export function ToolStopControl({
  controller,
  testIdPrefix = "tool",
  labeled = false,
}: {
  controller: StopController | null;
  testIdPrefix?: string;
  labeled?: boolean;
}) {
  const isMobile = useMobile();
  if (!controller) return null;
  const spec = SPECS[controller.state];
  const aria = spec.aria();
  const showLabel = labeled && !isMobile;
  const onClick =
    controller.state === "idle" ? controller.stop : controller.state === "aborting" ? controller.forceKill : undefined;
  const size = isMobile ? "min-w-[44px] min-h-[44px]" : "min-w-6 min-h-6";
  // Border width only on the labelled header variant; rows stay glyph-only.
  const border = labeled ? "border" : "";
  return (
    <button
      type="button"
      data-testid={`${testIdPrefix}-${spec.suffix}`}
      aria-label={aria}
      title={aria}
      disabled={spec.disabled}
      onClick={onClick}
      className={`ml-1 shrink-0 inline-flex items-center justify-center gap-1 rounded-md px-1 text-[11px] focus-ring ${size} ${border} ${spec.tone}`}
    >
      <Icon
        path={spec.icon}
        size={isMobile ? 0.7 : 0.55}
        spin={spec.spin}
        className={spec.spin ? "motion-reduce:animate-none" : undefined}
      />
      {showLabel && <span>{spec.label()}</span>}
    </button>
  );
}
