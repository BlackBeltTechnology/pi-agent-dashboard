/**
 * PlaybookCard — lazy `custom-entry-renderer` for `agent-teams-playbook`. One
 * collapsed row: template name and goal, read from the first two body lines of the
 * `playbook` mail (no request, no expand state — the container's `expanded` /
 * `onToggle` are ignored). Template and goal are plain React text, wrapped in
 * Unicode isolates so an RTL goal cannot reorder the label; the goal is clamped
 * by CSS and breaks anywhere, so it never overflows the row.
 * See change: add-agent-teams-templates-hooks (design D11).
 */
import type { CustomEntryRendererProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import type { ReactElement } from "react";
import { APPROVAL_TABLES } from "./approval-i18n.js";
import { parsePlaybookBody } from "./approval-parse.js";
import { useLazyT } from "./lazy-i18n.js";
import { MAIL_TABLES } from "./mail-i18n.js";
import { formatTime } from "./recipes.js";

/** First-strong-isolate … pop-directional-isolate: keeps `text` direction from leaking into its neighbours. */
const isolate = (text: string): string => `\u2068${text}\u2069`;

export function PlaybookCard({ body, timestamp }: CustomEntryRendererProps): ReactElement {
  const t = useLazyT(APPROVAL_TABLES);
  const mail = useLazyT(MAIL_TABLES);
  const parsed = parsePlaybookBody(body);
  const clock = formatTime(timestamp);
  const name = parsed?.template ?? "";
  return (
    <div role="group" aria-label={parsed ? t("playbook.label", { name }) : mail("card.unrecognisedTitle")} data-testid="team-playbook-card" className="my-1 mx-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 overflow-hidden rounded-lg border border-[var(--border-subtle)] border-l-[3px] border-l-[var(--border-strong)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs sm:mx-4">
      <span aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]">
        ◆
      </span>
      <span className="font-semibold text-[var(--text-primary)]" data-testid="team-playbook-title">
        {parsed ? t("playbook.title") : mail("card.unrecognisedTitle")}
      </span>
      {parsed ? (
        <>
          <span className="max-w-full rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-playbook-template">
            {t("playbook.template", { name: isolate(name) })}
          </span>
          {parsed.goal ? (
            <span className="min-w-0 flex-1 basis-40 line-clamp-2 text-[12px] text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-playbook-goal">
              {t("playbook.goal", { goal: isolate(parsed.goal) })}
            </span>
          ) : null}
        </>
      ) : (
        <span className="min-w-0 flex-1 basis-40 line-clamp-2 whitespace-pre-wrap text-[12px] text-[var(--text-primary)] [overflow-wrap:anywhere]" data-testid="team-playbook-goal">
          {body}
        </span>
      )}
      {clock !== undefined ? <span className="ml-auto text-[12px] text-[var(--text-secondary)]">{clock}</span> : null}
    </div>
  );
}
