/**
 * Phase-2 slot: toast.
 *
 * Mounts a fixed top-right tray that renders the currently-active toast
 * descriptors across all sessions. Behavior:
 *
 *   - No deduplication. Each `toast` descriptor is shown until either its
 *     `payload.durationMs` timer expires or the user dismisses it.
 *   - Auto-dismiss timer: `payload.durationMs` ms (default 5000; `0` = sticky).
 *   - Display cap: 5 toasts visible simultaneously. Excess is FIFO-evicted
 *     (oldest visible toast is dismissed first). Cache is unaffected; the
 *     cap is purely a render-time concern.
 *
 * See change: add-extension-ui-decorations, design.md §6.
 */

import type { DashboardSession, DecoratorDescriptor } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertCircle, mdiCheckCircle, mdiCloseCircle, mdiInformation } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useMemo, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

const DISPLAY_CAP = 5;
const DEFAULT_DURATION_MS = 5000;

interface ToastEntry {
  /** Stable key: `${sessionId}|${kind}:${namespace}:${id}`. */
  key: string;
  sessionId: string;
  descriptorKey: string;
  /** First-seen timestamp (drives FIFO eviction). */
  seenAt: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
  durationMs: number;
}

function levelIcon(level: ToastEntry["level"]): string {
  switch (level) {
    case "success": return mdiCheckCircle;
    case "warn":    return mdiAlertCircle;
    case "error":   return mdiCloseCircle;
    default:        return mdiInformation;
  }
}

// Protocol `level` names bridge onto the shared --severity-* color tokens.
// The protocol keeps `warn` (shared/types.ts); the token is `warning`, so the
// `warn` branch maps explicitly onto the --severity-warning-* triple. Without
// this bridge a protocol `warn` toast would address a token name that is never
// declared (there is no `warn`-spelled severity token).
// See change: unify-message-severity-colors (D5b).
function levelClass(level: ToastEntry["level"]): string {
  switch (level) {
    case "success": return "border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]";
    case "warn":    return "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]";
    case "error":   return "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]";
    default:        return "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]";
  }
}

/**
 * ToastSlot — mount once at the App root; reads decorators across all
 * subscribed sessions.
 */
export function ToastSlot({ sessions }: { sessions: Map<string, DashboardSession> | DashboardSession[] }) {
  // Flatten incoming toast descriptors across all sessions.
  const incoming = useMemo<ToastEntry[]>(() => {
    const list: ToastEntry[] = [];
    const sessionList: DashboardSession[] = sessions instanceof Map ? Array.from(sessions.values()) : sessions;
    const now = Date.now();
    for (const s of sessionList) {
      if (!s.uiDecorators) continue;
      for (const [k, d] of Object.entries(s.uiDecorators)) {
        if (d.kind !== "toast") continue;
        const td = d as Extract<DecoratorDescriptor, { kind: "toast" }>;
        list.push({
          key: `${s.id}|${k}`,
          sessionId: s.id,
          descriptorKey: k,
          seenAt: now,
          level: td.payload.level,
          message: td.payload.message,
          durationMs: typeof td.payload.durationMs === "number" ? td.payload.durationMs : DEFAULT_DURATION_MS,
        });
      }
    }
    return list;
  }, [sessions]);

  // Active set merges seen-time across renders so FIFO eviction is stable.
  const [active, setActive] = useState<ToastEntry[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setActive((prev) => {
      const prevByKey = new Map(prev.map((t) => [t.key, t]));
      const merged: ToastEntry[] = [];
      for (const t of incoming) {
        if (dismissed.has(t.key)) continue;
        const existing = prevByKey.get(t.key);
        merged.push(existing ? { ...t, seenAt: existing.seenAt } : t);
      }
      return merged;
    });
  }, [incoming, dismissed]);

  // Sort by seenAt ascending (oldest first); apply display cap by FIFO.
  const visible = [...active].sort((a, b) => a.seenAt - b.seenAt).slice(0, DISPLAY_CAP);

  // Schedule auto-dismiss timers.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const t of visible) {
      if (t.durationMs <= 0) continue; // sticky
      const remaining = Math.max(0, t.durationMs - (Date.now() - t.seenAt));
      timers.push(setTimeout(() => {
        setDismissed((prev) => {
          if (prev.has(t.key)) return prev;
          const next = new Set(prev);
          next.add(t.key);
          return next;
        });
      }, remaining));
    }
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [visible.map((t) => t.key).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (visible.length === 0) return null;

  const handleDismiss = (key: string) => {
    setDismissed((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return (
    <div
      className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      data-testid="toast-slot"
    >
      {visible.map((t) => (
        <div
          key={t.key}
          className={`pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-lg border shadow-lg max-w-sm ${levelClass(t.level)}`}
          data-testid={`toast:${t.descriptorKey}`}
        >
          <Icon path={levelIcon(t.level)} size={0.6} className="flex-shrink-0 mt-0.5" />
          <span className="text-[12px] flex-1 whitespace-pre-line">{t.message}</span>
          <button
            onClick={() => handleDismiss(t.key)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0"
            title={i18nT("common.dismiss", undefined, "Dismiss")}
            aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
