/**
 * MessageLog — chronological team mail (design D10): member filter, "Urgent only",
 * `from → to` rows with kind label, time, `urgent` / "not yet acknowledged" markers
 * and text bounded to 400 characters with a per-row disclosure. Unknown kinds
 * (`lock_grant`, `plan_request`, …) use the same generic row. A member filter keeps
 * mails sent by or to that member, and broadcasts (`*`) count as sent to every
 * member. The tail indicator comes from `mailTotal` ("Showing last N messages"; a
 * static "recent messages" when the field is absent; nothing when the list is
 * complete). `role="log"` stays `aria-live="off"` — the throttled live region
 * announces. Follows the newest row only while scrolled to the end (8 px
 * tolerance), otherwise shows "New messages". A filter on a vanished member resets
 * to "all" with an inline note. Peer text is plain React text.
 * See change: add-agent-teams-ui (design D10, D11; tasks 8.4, 13.17–13.18, 13.27–13.28).
 */
import { SettingsStatusPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import { memo, type ReactElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SnapshotMail } from "../shared/snapshot.js";
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { URGENT_MARKER } from "./status-map.js";
import { BTN, CHIP, Empty, formatTime, LINKBTN, TEXT, useViewT } from "./view-kit.js";

/** Rows longer than this get a per-row disclosure. */
export const MAIL_TEXT_BOUND = 400;
/** `scrollTop` distance from the bottom that still counts as "at the end". */
export const FOLLOW_TOLERANCE_PX = 8;
const BROADCAST = "*";

/** Mails a member filter keeps: sent by or to the member; broadcasts count as sent to everyone. */
export function matchesMember(m: Pick<SnapshotMail, "from" | "to">, member: string): boolean {
  return m.from === member || m.to === member || m.to === BROADCAST;
}

export interface RowProps {
  m: SnapshotMail;
  open: boolean;
  onToggle: (id: number) => void;
}

const sameMail = (a: SnapshotMail, b: SnapshotMail): boolean =>
  a.id === b.id && a.from === b.from && a.to === b.to && a.kind === b.kind && a.text === b.text && a.priority === b.priority && a.createdAt === b.createdAt && a.ackedAt === b.ackedAt;

/** Memo gate of a row: by value (a refetch replaces every object). */
export function sameMailRow(a: RowProps, b: RowProps): boolean {
  return sameMail(a.m, b.m) && a.open === b.open && a.onToggle === b.onToggle;
}

const MailRow = memo(
  function MailRow({ m, open, onToggle }: RowProps): ReactElement {
    const t = useViewT();
    const uid = useId();
    const long = m.text.length > MAIL_TEXT_BOUND;
    const shown = long && !open ? `${m.text.slice(0, MAIL_TEXT_BOUND)}…` : m.text;
    const time = formatTime(m.createdAt);
    const label = `kind.${m.kind}`;
    const known = t(label) !== label;
    return (
      <li data-testid="team-mail-row" data-kind={m.kind} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
          <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.from}</span>
          <span aria-hidden="true" className="text-[var(--text-secondary)]">
            →
          </span>
          <span className="sr-only">{t("log.to")}</span>
          <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{m.to === BROADCAST ? t("log.everyone") : m.to}</span>
          <span className={CHIP} data-testid="team-mail-kind">
            {known ? t(label) : m.kind.replace(/_/g, " ")}
          </span>
          {m.priority === "urgent" ? (
            <SettingsStatusPill tone="warning" icon={null} status="urgent" testId="team-mail-urgent">
              <span aria-hidden="true">{URGENT_MARKER.glyph}</span>
              {t(URGENT_MARKER.textKey)}
            </SettingsStatusPill>
          ) : null}
          {m.ackedAt === undefined ? <span className="text-[11px] text-[var(--text-secondary)]">{t("log.notAcked")}</span> : null}
          {time !== undefined ? (
            <time className="ml-auto text-[11px] text-[var(--text-secondary)]" dateTime={new Date(m.createdAt).toISOString()}>
              {time}
            </time>
          ) : (
            <span className="ml-auto text-[11px] text-[var(--text-secondary)]">{t("log.timeUnknown")}</span>
          )}
        </div>
        <p id={`${uid}-t`} className={`${TEXT} mt-1 text-[12px] text-[var(--text-primary)]`} data-testid="team-mail-text">
          {shown}
        </p>
        {long ? (
          <button type="button" aria-expanded={open} aria-controls={`${uid}-t`} onClick={() => onToggle(m.id)} className={`${LINKBTN} font-semibold`}>
            {open ? t("log.showLess") : t("log.showMore")}
          </button>
        ) : null}
      </li>
    );
  },
  sameMailRow,
);

export function MessageLog({ snap }: { snap: TeamUiSnapshot }): ReactElement {
  const t = useViewT();
  const [filter, setFilter] = useState("all");
  const [vanishedNote, setVanishedNote] = useState<string | undefined>();
  const [urgent, setUrgent] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const selId = useId();

  // A filter on a member that left the team resets to "all" with an inline note.
  useEffect(() => {
    if (filter !== "all" && filter !== "lead" && !snap.members.some((m) => m.name === filter)) {
      setVanishedNote(filter);
      setFilter("all");
    }
  }, [filter, snap.members]);

  const rows = snap.mail.filter((m) => (filter === "all" || matchesMember(m, filter)) && (!urgent || m.priority === "urgent"));
  const names = ["lead", ...snap.members.map((m) => m.name)];
  const toggle = useCallback((id: number): void => {
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Follow the newest row only while scrolled to the end.
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const lastLength = useRef(rows.length);
  const [unseen, setUnseen] = useState(false);
  const toEnd = (): void => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    atEnd.current = true;
    setUnseen(false);
  };
  const onScroll = (): void => {
    const el = scroller.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_TOLERANCE_PX;
    if (atEnd.current) setUnseen(false);
  };
  useLayoutEffect(() => {
    const grew = rows.length > lastLength.current;
    lastLength.current = rows.length;
    if (!grew) return;
    if (atEnd.current) {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else setUnseen(true);
  }, [rows.length]);

  const tail = typeof snap.mailTotal !== "number" ? t("log.recent") : snap.mailTotal > snap.mail.length ? t("log.tail", { n: snap.mail.length }) : undefined;

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid="team-log">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selId} className="text-[12px] font-semibold text-[var(--text-primary)]">
          {t("log.member")}
        </label>
        <select
          id={selId}
          value={filter}
          onChange={(e) => {
            setVanishedNote(undefined);
            setFilter(e.target.value);
          }}
          className="focus-ring min-h-[44px] sm:min-h-[32px] rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] text-[var(--text-primary)]"
        >
          <option value="all">{t("log.all")}</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={urgent}
          onClick={() => setUrgent((u) => !u)}
          className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 min-h-[44px] sm:min-h-[32px] text-xs font-semibold ${urgent ? "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]" : "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"}`}
        >
          {urgent ? <span aria-hidden="true">✓</span> : null}
          {t("log.urgentOnly")}
        </button>
      </div>
      {vanishedNote !== undefined ? (
        <p className={`${TEXT} text-[11px] text-[var(--text-secondary)]`} data-testid="team-log-vanished">
          {t("log.vanished", { name: vanishedNote })}
        </p>
      ) : null}
      {tail !== undefined ? (
        <p className="text-[11px] text-[var(--text-secondary)]" data-testid="team-log-scope">
          {tail}
        </p>
      ) : null}
      {rows.length === 0 ? (
        snap.mail.length === 0 ? (
          <Empty testId="team-log-empty" title={t("log.none.title")} hint={t("log.none.hint")} />
        ) : (
          <Empty testId="team-log-nomatch" title={t("log.noMatch.title")} hint={t("log.noMatch.hint")} />
        )
      ) : (
        <div ref={scroller} onScroll={onScroll} role="log" aria-live="off" aria-label={t("log.label")} tabIndex={0} className="focus-ring max-h-[70vh] min-h-0 overflow-y-auto" data-testid="team-log-scroller">
          <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
            {rows.map((m) => (
              <MailRow key={m.id} m={m} open={open.has(m.id)} onToggle={toggle} />
            ))}
          </ol>
        </div>
      )}
      {unseen ? (
        <button type="button" className={`${BTN} self-center`} data-testid="team-log-new" onClick={toEnd}>
          <span aria-hidden="true">↓</span>
          {t("log.newMessages")}
        </button>
      ) : null}
    </div>
  );
}
