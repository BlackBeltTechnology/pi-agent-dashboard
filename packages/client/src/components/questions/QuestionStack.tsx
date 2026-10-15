/**
 * QuestionStack — the open-questions pill (sidebar header row 1, after the YOLO
 * slot) + dropdown panel + the answer dialog host.
 *
 * - Pill: shown only while ≥1 question is open; accessible name states the
 *   count; opens the panel (`aria-expanded` / `aria-controls`). New-arrival ring
 *   (`arrive`) runs once and is suppressed under `prefers-reduced-motion`.
 * - Panel: newest-first; newest 5 + "+N more" → scrollable list ≤ 60vh. Desktop:
 *   anchored under header row 1 at the sidebar width. Mobile tier: bottom sheet.
 *   Esc / outside click closes; focus returns to the pill.
 * - Activation routes by session visibility (`routeQuestion`): visible → select
 *   the session (`onOpenSession`) and bring the prompt into view; otherwise the
 *   `QuestionDialog` opens.
 * Theme tokens only. See change: add-pending-question-stack.
 */
import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { useFocusTrap } from "@blackbelt-technology/pi-dashboard-client-utils/useFocusTrap";
import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
import type { QuestionOrigin, QuestionRow } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { QUESTION_PREVIEW_MAX } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArrowRight,
  mdiCommentQuestion,
  mdiCommentQuestionOutline,
  mdiForumOutline,
  mdiLoading,
  mdiShieldAlertOutline,
  mdiViewDashboardOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type QuestionStackStore, useQuestionStack } from "../../lib/questions/question-store.js";
import { decideQuestionRoute, routeQuestion } from "../../lib/questions/route-question.js";
import { useNow } from "../../lib/time/use-now.js";
import { formatRelativeTime } from "../../lib/util/format.js";

/** Opened on demand only — kept off the entry chunk (mdi-chunk-size gz cap). */
const QuestionDialog = lazy(() => import("./QuestionDialog.js").then((m) => ({ default: m.QuestionDialog })));

const VISIBLE_ROWS = 5;
const ARRIVE_MS = 600;

export interface QuestionStackProps {
  /** Board sessions (visibility decides the route). */
  sessions: readonly DashboardSession[];
  /** Select the session, reveal it through filters / collapsed folders, open its chat. */
  onOpenSession: (sessionId: string) => void;
  /** Test seam; defaults to the app-wide store fed by `questions_update`. */
  store?: QuestionStackStore;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True for `ARRIVE_MS` after a question id appears that was not open before. */
function useArrival(rows: readonly QuestionRow[], loaded: boolean): boolean {
  const seen = useRef<{ ids: Set<string>; loaded: boolean } | null>(null);
  const [arriving, setArriving] = useState(false);
  useEffect(() => {
    const previous = seen.current;
    seen.current = { ids: new Set(rows.map((r) => r.id)), loaded };
    // The first frame (even a non-empty one) is the baseline, not an arrival.
    if (!loaded || previous === null || !previous.loaded) return;
    const fresh = rows.some((r) => !previous.ids.has(r.id));
    if (!fresh || prefersReducedMotion()) return;
    setArriving(true);
    const id = setTimeout(() => setArriving(false), ARRIVE_MS);
    return () => clearTimeout(id);
  }, [rows, loaded]);
  return arriving;
}

const ORIGIN: Record<QuestionOrigin, { icon: string; key: string; en: string }> = {
  file: { icon: mdiShieldAlertOutline, key: "questions.origin.file", en: "File access" },
  "chat-gateway": { icon: mdiForumOutline, key: "questions.origin.chatGateway", en: "Chat gateway" },
  "widget-bar": { icon: mdiViewDashboardOutline, key: "questions.origin.widgetBar", en: "Flow slot" },
};

function OriginBadge({ origin }: { origin: QuestionOrigin }) {
  const o = ORIGIN[origin];
  const tone =
    origin === "file"
      ? "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]"
      : "border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-secondary)]";
  return (
    <span data-testid="question-origin" data-origin={origin} className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] leading-none ${tone}`}>
      <Icon path={o.icon} size={0.45} />
      {i18nT(o.key, undefined, o.en)}
    </span>
  );
}

function QuestionRowItem({
  row,
  visible,
  now,
  mobile,
  onActivate,
}: {
  row: QuestionRow;
  visible: boolean;
  now: number;
  mobile: boolean;
  onActivate: (row: QuestionRow) => void;
}) {
  const preview = row.preview.length > QUESTION_PREVIEW_MAX ? `${row.preview.slice(0, QUESTION_PREVIEW_MAX - 1)}…` : row.preview;
  return (
    <li>
      <button
        type="button"
        data-testid={`question-row-${row.id}`}
        onClick={() => onActivate(row)}
        className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] focus-ring ${mobile ? "min-h-[44px]" : ""}`}
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">
            {row.sessionLabel}
            {row.changeName && (
              <span className="ml-1.5 rounded bg-[var(--bg-surface)] px-1 py-0.5 text-[10px] font-normal text-[var(--text-secondary)]">{row.changeName}</span>
            )}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
            {i18nT("questions.age", { time: formatRelativeTime(now - row.askedAt) }, "{time} ago")}
          </span>
        </span>
        <span data-testid="question-preview" className="line-clamp-2 text-[12px] text-[var(--text-secondary)]">
          {preview}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px]">
          {row.origin && <OriginBadge origin={row.origin} />}
          {row.briefStatus === "pending" && (
            <span className="inline-flex items-center gap-0.5 text-[var(--text-secondary)]">
              <Icon path={mdiLoading} size={0.45} className="animate-spin motion-reduce:animate-none" />
              {i18nT("questions.summarizing", undefined, "Summarizing…")}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-0.5 text-[var(--text-secondary)]">
            {visible ? i18nT("questions.route.go", undefined, "Go to session") : i18nT("questions.route.answer", undefined, "Answer here")}
            <Icon path={visible ? mdiArrowRight : mdiCommentQuestionOutline} size={0.5} />
          </span>
        </span>
      </button>
    </li>
  );
}

interface PanelProps {
  rows: readonly QuestionRow[];
  sessionById: ReadonlyMap<string, DashboardSession>;
  anchor: HTMLElement | null;
  mobile: boolean;
  panelId: string;
  onActivate: (row: QuestionRow) => void;
  onClose: () => void;
  pillRef: React.RefObject<HTMLButtonElement | null>;
}

function QuestionPanel({ rows, sessionById, anchor, mobile, panelId, onActivate, onClose, pillRef }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const now = useNow(true);

  useFocusTrap(ref, true);
  useEscapeDismiss(true, onClose);

  // Outside click closes (the pill toggles itself).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || pillRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose, pillRef]);

  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const more = rows.length - VISIBLE_ROWS;
  const rect = anchor?.getBoundingClientRect();
  const desktopStyle = rect && rect.width > 0 ? { left: rect.left, top: rect.bottom, width: rect.width } : undefined;

  const panel = (
    <div
      ref={ref}
      id={panelId}
      role="region"
      aria-label={i18nT("questions.panel.label", undefined, "Open questions")}
      data-testid="question-panel"
      data-variant={mobile ? "sheet" : "dropdown"}
      style={mobile ? { maxHeight: "80vh" } : desktopStyle}
      className={
        mobile
          ? "fixed inset-x-0 bottom-0 z-popover flex flex-col rounded-t-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-xl"
          : `fixed z-popover flex flex-col rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-xl ${desktopStyle ? "" : "left-0 top-10 w-80"}`
      }
    >
      {mobile && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded bg-[var(--border-secondary)]" />}
      <h2 className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        {i18nT("questions.panel.heading", { count: rows.length }, "Needs you · {count}")}
      </h2>
      <ul
        data-testid="question-list"
        style={expanded ? { maxHeight: "60vh" } : undefined}
        className={`flex flex-col gap-1 px-2 pb-2 ${expanded ? "overflow-y-auto" : ""}`}
      >
        {shown.map((row) => (
          <QuestionRowItem
            key={row.id}
            row={row}
            visible={decideQuestionRoute(row, sessionById.get(row.sessionId)) !== "dialog"}
            now={now}
            mobile={mobile}
            onActivate={onActivate}
          />
        ))}
        {!expanded && more > 0 && (
          <li>
            <button
              type="button"
              data-testid="question-more"
              onClick={() => setExpanded(true)}
              className={`w-full rounded px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-ring ${mobile ? "min-h-[44px]" : ""}`}
            >
              {i18nT("questions.more", { count: more }, "+{count} more")}
            </button>
          </li>
        )}
      </ul>
    </div>
  );

  return createPortal(
    mobile ? (
      <>
        <div aria-hidden="true" className="fixed inset-0 z-overlay bg-[var(--bg-overlay)]" onClick={onClose} data-testid="question-sheet-scrim" />
        {panel}
      </>
    ) : (
      panel
    ),
    document.body,
  );
}

export function QuestionStack({ sessions, onOpenSession, store }: QuestionStackProps) {
  const { rows, loaded } = useQuestionStack(store);
  const mobile = useMobile();
  const panelId = useId();
  const pillRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dialogRow, setDialogRow] = useState<QuestionRow | null>(null);
  const arriving = useArrival(rows, loaded);

  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  // Keep the dialog's row current; `undefined` means it left the stack.
  const liveDialogRow = dialogRow ? rows.find((r) => r.id === dialogRow.id) : undefined;

  const closePanel = useCallback(() => {
    setOpen(false);
    pillRef.current?.focus();
  }, []);

  const closeDialog = useCallback(() => {
    setDialogRow(null);
    pillRef.current?.focus();
  }, []);

  const activate = useCallback(
    (row: QuestionRow) => {
      setOpen(false);
      routeQuestion(row, {
        session: sessionById.get(row.sessionId),
        openSession: onOpenSession,
        openDialog: setDialogRow,
      });
    },
    [sessionById, onOpenSession],
  );

  // The panel never outlives the last question.
  useEffect(() => {
    if (rows.length === 0) setOpen(false);
  }, [rows.length]);

  const count = rows.length;
  if (count === 0 && !dialogRow) return null;

  const name =
    count === 1
      ? i18nT("questions.pill.one", undefined, "1 open question")
      : i18nT("questions.pill.many", { count }, "{count} open questions");

  return (
    <>
      {count > 0 && (
        <button
          ref={pillRef}
          type="button"
          data-testid="question-pill"
          aria-label={name}
          aria-expanded={open}
          aria-controls={panelId}
          aria-haspopup="true"
          onClick={() => setOpen((o) => !o)}
          className={`question-pill inline-flex items-center justify-center gap-0.5 rounded border border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)] px-1.5 py-0.5 text-[10px] leading-none tabular-nums text-[var(--tint-purple-fg)] focus-ring ${
            mobile ? "min-h-[44px] min-w-[44px]" : "min-h-6 min-w-6"
          }${arriving ? " arrive" : ""}`}
        >
          <Icon path={mdiCommentQuestion} size={0.5} className="text-[var(--status-needs-you)]" />
          {count}
        </button>
      )}
      {open && count > 0 && (
        <QuestionPanel
          rows={rows}
          sessionById={sessionById}
          anchor={pillRef.current?.closest<HTMLElement>('[data-testid="header-app-bar"]') ?? null}
          mobile={mobile}
          panelId={panelId}
          onActivate={activate}
          onClose={closePanel}
          pillRef={pillRef}
        />
      )}
      {dialogRow && (
        <Suspense fallback={null}>
        <QuestionDialog
          row={liveDialogRow ?? dialogRow}
          gone={liveDialogRow === undefined}
          onClose={closeDialog}
          onOpenSession={(id) => {
            setDialogRow(null);
            onOpenSession(id);
          }}
        />
        </Suspense>
      )}
    </>
  );
}
