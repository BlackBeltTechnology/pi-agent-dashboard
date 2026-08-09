/**
 * Folder-header status capsule: the folder's ONE liveness surface. Replaces the
 * raw `(N)` session count, `FolderNeedsYouPill` and the collapsed-only
 * `FolderStatusRollup` with a single severity-ordered control that renders in
 * BOTH collapse states.
 *
 * Segments render in the fixed order needs-you > error > working > idle
 * (`CAPSULE_SEGMENT_ORDER`) — magnitude never reorders them. Zero-count
 * segments are absent; a folder with nothing countable renders no capsule.
 *
 * Non-idle segments are `<button>`s that navigate to the first session of that
 * state. The idle segment is an inert `<span>` — NOT a disabled button, which a
 * screen reader still announces as an unavailable control — but it keeps an
 * accessible label so it is not announced as a bare number.
 *
 * Widget-bar-placed prompts are excluded, via the same hidden-probe mechanism
 * `FolderNeedsYouPill` owned: one `WidgetBarProbe` per `ask_user` candidate,
 * keyed by session id, reporting into a `Map`. Absent from the map = not yet
 * classified = excluded, so the capsule never flashes an over-count on mount.
 *
 * Colours come from the semantic `--status-*` family (the same tokens the
 * SessionCard dot consumes), never the `--severity-*` toast/banner family.
 *
 * See change: unify-folder-status-capsule.
 */

import { useHasWidgetBarPrompt } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { Icon } from "@mdi/react";
import React, { useCallback, useMemo, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  CAPSULE_SEGMENT_ORDER,
  type CapsuleBucket,
  countStatusCapsule,
  statusShapeIcon,
} from "../../lib/session/session-status-visuals.js";

function WidgetBarProbe({
  sessionId,
  onResult,
}: {
  sessionId: string;
  onResult: (sessionId: string, isWidgetBar: boolean | undefined) => void;
}) {
  const isWidgetBar = useHasWidgetBarPrompt(sessionId);
  React.useEffect(() => {
    onResult(sessionId, isWidgetBar);
  }, [sessionId, isWidgetBar, onResult]);
  return null;
}

/** Four glyphs max — the capsule never wraps, so an uncapped count would push
 * the header past its width budget at narrow sidebar widths. */
function capCount(n: number): string {
  return n > 999 ? "999+" : String(n);
}

/**
 * Per-bucket presentation. Class strings are written as LITERALS so Tailwind's
 * JIT scans them — do not build these by interpolation.
 */
const SEGMENT_META: Record<
  CapsuleBucket,
  { testKey: string; shape: "needs-you" | "error" | "working" | "idle"; className: string }
> = {
  needsYou: {
    testKey: "needs-you",
    shape: "needs-you",
    className:
      "text-[var(--status-needs-you)] border-[color-mix(in_srgb,var(--status-needs-you)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-needs-you)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-needs-you)_20%,transparent)]",
  },
  error: {
    testKey: "error",
    shape: "error",
    className:
      "text-[var(--status-error)] border-[color-mix(in_srgb,var(--status-error)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-error)_20%,transparent)]",
  },
  working: {
    testKey: "working",
    shape: "working",
    className:
      "text-[var(--status-working)] border-[color-mix(in_srgb,var(--status-working)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-working)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-working)_20%,transparent)]",
  },
  idle: {
    testKey: "idle",
    shape: "idle",
    className:
      "text-[var(--status-idle)] border-[color-mix(in_srgb,var(--status-idle)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-idle)_12%,transparent)]",
  },
};

function segmentLabel(bucket: CapsuleBucket, count: number): string {
  switch (bucket) {
    case "needsYou":
      return i18nT(
        "folders.capsuleNeedsYou",
        { count },
        `${count} sessions blocked on you — go to first`,
      );
    case "error":
      return i18nT("folders.capsuleError", { count }, `${count} errored sessions — go to first`);
    case "working":
      return i18nT("folders.capsuleWorking", { count }, `${count} working sessions — go to first`);
    case "idle":
      return i18nT("folders.capsuleIdle", { count }, `${count} idle sessions`);
  }
}

export function FolderStatusCapsule({
  cwd,
  sessions,
  errorSessionIds,
  retrySessionIds,
  noticeSessionIds,
  onActivate,
}: {
  cwd: string;
  sessions: DashboardSession[];
  errorSessionIds?: Set<string>;
  retrySessionIds?: Set<string>;
  noticeSessionIds?: Set<string>;
  /** Invoked with the first session id of the activated segment's state. */
  onActivate: (sessionId: string) => void;
}) {
  // One probe per live `ask_user` candidate. `useHasWidgetBarPrompt` is a hook
  // and cannot be called in a loop over a varying list, hence the child-probe
  // mechanism rather than a direct map.
  const candidates = useMemo(
    () =>
      sessions.filter(
        (s) => s.currentTool === "ask_user" && s.status !== "ended" && s.hidden !== true,
      ),
    [sessions],
  );

  const [classified, setClassified] = useState<Map<string, boolean | undefined>>(() => new Map());

  const onResult = useCallback((sessionId: string, isWidgetBar: boolean | undefined) => {
    setClassified((prev) => {
      if (prev.get(sessionId) === isWidgetBar) return prev;
      const next = new Map(prev);
      next.set(sessionId, isWidgetBar);
      return next;
    });
  }, []);

  // Absent OR undefined = not yet classified = excluded from every bucket.
  const widgetBar = useCallback((id: string) => classified.get(id), [classified]);

  const counts = countStatusCapsule(sessions, {
    errorSessionIds,
    retrySessionIds,
    noticeSessionIds,
    widgetBar,
  });

  const visible = CAPSULE_SEGMENT_ORDER.filter((bucket) => counts[bucket] > 0);

  return (
    <>
      {candidates.map((s) => (
        <WidgetBarProbe key={s.id} sessionId={s.id} onResult={onResult} />
      ))}
      {visible.length > 0 && (
        <span
          className="inline-flex items-center gap-1 flex-none whitespace-nowrap"
          data-testid={`folder-status-capsule-${cwd}`}
        >
          {visible.map((bucket) => {
            const meta = SEGMENT_META[bucket];
            const count = counts[bucket];
            const label = segmentLabel(bucket, count);
            const testId = `folder-capsule-seg-${meta.testKey}-${cwd}`;
            const shared = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${meta.className}`;
            const icon = (
              <Icon path={statusShapeIcon[meta.shape] ?? ""} size={0.45} className="shrink-0" />
            );

            // The idle segment is inert: a plain span, not focusable, no handler.
            if (bucket === "idle") {
              return (
                <span
                  key={bucket}
                  className={shared}
                  data-testid={testId}
                  data-capsule-segment={meta.testKey}
                  aria-label={label}
                >
                  {icon}
                  <span>{capCount(count)}</span>
                </span>
              );
            }

            return (
              <button
                key={bucket}
                type="button"
                onClick={(e) => {
                  // The header row carries its own onClick (directory-home
                  // navigation) — never let activation toggle the row.
                  e.stopPropagation();
                  const target = counts.firstIds[bucket];
                  if (target) onActivate(target);
                }}
                className={`${shared} cursor-pointer`}
                data-testid={testId}
                data-capsule-segment={meta.testKey}
                aria-label={label}
                title={label}
              >
                {icon}
                <span>{capCount(count)}</span>
              </button>
            );
          })}
        </span>
      )}
    </>
  );
}
