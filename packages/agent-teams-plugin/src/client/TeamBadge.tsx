/**
 * TeamBadge — eager `session-card-badge` claim (design D6, decided mock: the
 * Proposed frame of `…-agent-teams-session-badge`, `◆ Team │ Lead` / `◇ Team │ name`).
 * Text + decorative glyph on the neutral severity family; a keyboard-focusable
 * link to the Team view with an accessible name that states the role. No `@mdi`
 * import (cold-chunk budget); labels come from the eager catalog.
 * See change: add-agent-teams-ui.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { MouseEvent, ReactElement } from "react";
import { Link } from "wouter";
import { teamViewPath } from "./routes.js";
import { teamRoleOf } from "./team-refs.js";

/** The badge lives inside a clickable session card; opening the Team view must not also select the session. */
const stopCardClick = (e: MouseEvent): void => e.stopPropagation();

export function TeamBadge({ session }: { session: { id: string } }): ReactElement | null {
  const t = useT();
  const role = teamRoleOf(session);
  if (!role) return null;
  const lead = role.kind === "lead";
  const label = lead ? t("badgeLead", undefined, "Lead") : (role.name ?? "?");
  return (
    <Link
      href={teamViewPath(session.id)}
      aria-label={t("badgeOpen", { role: label }, `Open team view, ${label}`)}
      data-testid="team-badge"
      onClick={stopCardClick}
      className="focus-ring inline-flex min-h-[24px] max-w-full items-stretch overflow-hidden rounded-full border border-[var(--severity-neutral-border)] bg-[var(--severity-neutral-bg)] text-[11px] font-semibold text-[var(--severity-neutral-fg)]"
    >
      <span className="inline-flex items-center gap-1 border-r border-inherit px-1.5">
        <span aria-hidden="true">{lead ? "◆" : "◇"}</span>
        {t("badgeTeam", undefined, "Team")}
      </span>
      <span className="inline-flex min-w-0 items-center truncate px-1.5">{label}</span>
    </Link>
  );
}
