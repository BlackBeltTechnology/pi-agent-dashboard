/**
 * MailEntryCard — lazy `custom-entry-renderer` for `agent-teams-mail`,
 * `agent-teams-idle` and `agent-teams-notice` (design D4, D5, D11; task 8.2).
 * Everything shown comes from the row body alone: `parseMailBody` (built on core's
 * `parseEnvelope`, first line at offset 0 only) gives kind / sender / urgency / text.
 * The sender role is derived from the PARSED sender class (Lead / Server / Teammate
 * <name>); a reserved or out-of-grammar sender, or a lost header, never names a
 * sender ("unrecognised agent message" / "header truncated"). Notices group into
 * items (`• ` item, `│ ` continuation inside it). The expand toggle is always
 * rendered, wired to the container's `expanded` / `onToggle`; no request is ever
 * made and `payload*` props are ignored. Peer text is plain React text children
 * (`pre-wrap`, `overflow-wrap:anywhere`) — no markdown, HTML or links; no approval
 * control exists. Never an element or attribute built from agent text beyond the
 * grammar-checked member name in the group label.
 * See change: add-agent-teams-ui.
 */
import { SettingsStatusPill } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { type ReactElement, type ReactNode, useId } from "react";
import { Link } from "wouter";
import { CUSTOM_TYPE_IDLE, CUSTOM_TYPE_NOTICE } from "../shared/mail-format.js";
import { useLazyT } from "./lazy-i18n.js";
import { MAIL_TABLES } from "./mail-i18n.js";
import { type MailSender, type NoticeItem, parseMailBody, parseNoticeItems } from "./mail-parse.js";
import { formatTime, LINKBTN } from "./recipes.js";
import { teamViewPath } from "./routes.js";
import { URGENT_MARKER } from "./status-map.js";

const PLAIN = "whitespace-pre-wrap [overflow-wrap:anywhere]";

type Translate = ReturnType<typeof useLazyT>;

const senderLabel = (t: Translate, s: MailSender): string => (s.role === "lead" ? t("role.lead") : s.role === "server" ? t("role.server") : t("role.member", { name: s.name }));

interface ShellProps {
  id: string;
  title: string;
  kind?: string;
  sender?: string;
  urgent?: boolean;
  time: number;
  expanded: boolean;
  onToggle: () => void;
  collapsed: ReactNode;
  full: ReactNode;
  label: string;
  footer?: ReactNode;
}

function Shell({ id, title, kind, sender, urgent, time, expanded, onToggle, collapsed, full, label, footer }: ShellProps): ReactElement {
  const t = useLazyT(MAIL_TABLES);
  const bodyId = `${id}-body`;
  const clock = formatTime(time);
  return (
    <div role="group" aria-label={label} data-testid="team-mail-card" className="my-1 mx-2 overflow-hidden rounded-lg border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--border-strong)] bg-[var(--bg-secondary)] text-xs sm:mx-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-1.5">
        <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">
          ◆
        </span>
        <span className="font-semibold text-[var(--text-primary)]" data-testid="team-mail-title">
          {title}
        </span>
        {kind ? (
          <span className="rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-mail-kind">
            {kind}
          </span>
        ) : null}
        {sender ? (
          <span className="text-[12px] text-[var(--text-secondary)]">
            {t("card.from")} <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-mail-sender">{sender}</span>
          </span>
        ) : null}
        {urgent ? (
          <SettingsStatusPill tone="warning" icon={null} status="urgent" testId="team-mail-urgent">
            <span aria-hidden="true">{URGENT_MARKER.glyph}</span>
            {t("card.urgent")}
          </SettingsStatusPill>
        ) : null}
        {clock !== undefined ? <span className="ml-auto text-[12px] text-[var(--text-secondary)]">{clock}</span> : null}
      </div>
      <div className="px-3 pb-1.5 pt-1">
        {expanded ? (
          <div id={bodyId} tabIndex={0} data-testid="team-mail-body" className={`${PLAIN} focus-ring max-h-[60vh] overflow-y-auto rounded bg-[var(--bg-tertiary)] p-2 text-[12px] text-[var(--text-primary)]`}>
            {full}
          </div>
        ) : (
          <div id={bodyId} data-testid="team-mail-body" className={`${PLAIN} line-clamp-2 text-[12px] text-[var(--text-primary)]`}>
            {collapsed}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3">
          {/* D14: the toggle is always rendered — a stable control, not one that appears with the text length. */}
          <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle} className={`${LINKBTN} font-semibold`} data-testid="team-mail-toggle">
            {expanded ? t("card.showLess") : t("card.showMore")}
          </button>
          {footer}
        </div>
      </div>
    </div>
  );
}

function Items({ items }: { items: NoticeItem[] }): ReactElement {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="team-mail-items">
      {items.map((it, i) => (
        <li key={i} className="flex gap-1.5" data-testid="team-mail-item">
          <span aria-hidden="true">•</span>
          <div className="min-w-0">
            <div>{it.head}</div>
            {it.cont.length > 0 ? <div className="ml-1 mt-0.5 border-l-2 border-[var(--border-secondary)] pl-2 text-[var(--text-secondary)]">{it.cont.join("\n")}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** One component for the three mail customTypes; derives everything from `customType` and `body`, issues no request. */
export function MailEntryCard({ customType, body, timestamp, sessionId, expanded, onToggle }: CustomEntryRendererProps): ReactElement {
  const t = useLazyT(MAIL_TABLES);
  const id = useId();
  const common = { id, time: timestamp, expanded, onToggle };
  const parsed = parseMailBody(body);

  if (parsed.type === "truncated") {
    return <Shell {...common} title={t("card.truncatedTitle")} label={t("card.truncatedLabel")} collapsed={body} full={body} footer={<span className="text-[12px] text-[var(--text-secondary)]">{t("card.truncatedNote")}</span>} />;
  }
  if (parsed.type === "unrecognised") {
    return <Shell {...common} title={t("card.unrecognisedTitle")} label={t("card.unrecognisedTitle")} collapsed={body} full={body} footer={<span className="text-[12px] text-[var(--text-secondary)]">{t("card.unrecognisedNote")}</span>} />;
  }

  const sender = senderLabel(t, parsed.sender);
  const text = parsed.text;
  const teamLink = sessionId ? (
    <Link href={teamViewPath(sessionId)} className={`${LINKBTN} font-semibold`} data-testid="team-mail-open-team">
      {t("card.openTeam")}
    </Link>
  ) : null;

  if (customType === CUSTOM_TYPE_NOTICE) {
    const items = parseNoticeItems(text);
    const first = items[0];
    return (
      <Shell
        {...common}
        title={t("card.noticeTitle")}
        sender={sender}
        urgent={parsed.urgent}
        label={t("card.noticeLabel", { sender })}
        collapsed={
          first === undefined ? (
            t("card.noticeEmpty")
          ) : (
            <>
              {first.head}
              {items.length > 1 ? <span className="ml-1 font-semibold text-[var(--text-secondary)]" data-testid="team-mail-more"> {t("card.noticeMore", { n: items.length - 1 })}</span> : null}
            </>
          )
        }
        full={items.length === 0 ? t("card.noticeEmpty") : <Items items={items} />}
        footer={teamLink}
      />
    );
  }
  if (customType === CUSTOM_TYPE_IDLE) {
    return <Shell {...common} title={t("card.idleTitle", { sender })} urgent={parsed.urgent} label={t("card.idleLabel", { sender })} collapsed={text} full={text} />;
  }
  const kindKey = `kind.${parsed.kind}`;
  const known = t(kindKey) !== kindKey;
  return <Shell {...common} title={t("card.title")} kind={known ? t(kindKey) : parsed.kind.replace(/_/g, " ")} sender={sender} urgent={parsed.urgent} label={t("card.groupLabel", { sender })} collapsed={text} full={text} />;
}

