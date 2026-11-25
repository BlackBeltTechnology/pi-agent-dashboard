/**
 * TeamViewClaim — the lazy `shell-overlay-route` body of `/session/:sessionId/team`
 * (design D1, D2, D10; decided mock: tabs on every width, members as a table, the
 * board as a grouped list on narrow viewports). It resolves the route session to its
 * team through the module store, mounts the render-less `TeamsFeeder` (frames,
 * reconnect, visibility, 60 s timer) and renders: header + notices, the Members ·
 * Tasks · Messages tablist with its three panels (all mounted, one visible, so
 * scroll / disclosure / filter state survives tab switches and refetches), the
 * polite live region, and every non-ready state — loading skeleton (`aria-busy`),
 * no team (an empty lookup, no existence oracle), not found (only after a resolved
 * team answers 404), error with retry, stale notice over the kept snapshot.
 * `data-testid`s of change 5: `team-member-open-subagent`, `team-member-status`,
 * `team-header-mode`, `team-header-parallel`. Plain-text only for peer text.
 * See change: add-agent-teams-ui (tasks 8.4–8.7).
 */
import { SettingsNotice } from "@blackbelt-technology/dashboard-plugin-runtime";
import { type ReactElement, useCallback, useState } from "react";
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { LiveRegion } from "./LiveRegion.js";
import { MembersGrid } from "./MembersGrid.js";
import { MessageLog } from "./MessageLog.js";
import { TaskBoard } from "./TaskBoard.js";
import { TeamHeader } from "./TeamHeader.js";
import { TABS, type TeamTab, TeamTabs, tabId, tabPanelId } from "./TeamTabs.js";
import { useTeamControls } from "./team-controls.js";
import { TeamsFeeder } from "./teams-feeder.js";
import { useSessionLookup, useTeamEntry } from "./teams-hooks.js";
import { type TeamsStore, teamsStore } from "./teams-store.js";
import { BTN, Empty, useViewT } from "./view-kit.js";

export interface TeamViewProps {
  /** `shell-overlay-route` props: `params.sessionId` is the route session. */
  params: Record<string, string | undefined>;
  onBack?: () => void;
  /** Test seam; defaults to the shared module store. */
  store?: TeamsStore;
}

function Skeleton(): ReactElement {
  const t = useViewT();
  const bar = "rounded-md bg-[var(--bg-tertiary)] animate-pulse motion-reduce:animate-none";
  return (
    <div aria-busy="true" data-testid="team-loading" className="flex flex-1 flex-col gap-3 p-3">
      <span role="status" className="sr-only">
        {t("loading.label")}
      </span>
      <div className={`${bar} h-8 w-1/2`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${bar} h-24`} />
        ))}
      </div>
    </div>
  );
}

/** A non-ready state: Back to the session plus its one panel. */
function StateFrame({ onBack, children }: { onBack: () => void; children: ReactElement }): ReactElement {
  const t = useViewT();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="team-state">
      <div className="shrink-0 border-b border-[var(--border-primary)] px-3 py-2">
        <button type="button" className={BTN} onClick={onBack} data-testid="team-back">
          <span aria-hidden="true">←</span>
          {t("common.backToSession")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </div>
  );
}

interface ReadyProps {
  snap: TeamUiSnapshot;
  stale: boolean;
  sessionId: string;
  store: TeamsStore;
  onBack: () => void;
}

function ReadyView({ snap, stale, sessionId, store, onBack }: ReadyProps): ReactElement {
  const t = useViewT();
  const controls = useTeamControls(snap.id, store);
  const [tab, setTab] = useState<TeamTab>("members");
  const [ownerFilter, setOwnerFilter] = useState<string | undefined>();
  const [focus, setFocus] = useState<{ id: string; nonce: number } | undefined>();
  const viewedFrom = snap.members.find((m) => m.sessionId === sessionId)?.name;

  const focusTask = useCallback((id: string) => {
    setTab("tasks");
    setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);
  const showMemberTasks = useCallback((name: string) => {
    setOwnerFilter(name);
    setTab("tasks");
  }, []);
  const clearFilter = useCallback(() => setOwnerFilter(undefined), []);

  const counts = { members: snap.members.length, tasks: snap.tasks.length, messages: typeof snap.mailTotal === "number" ? snap.mailTotal : snap.mail.length };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="team-view">
      <TeamHeader snap={snap} viewedFrom={viewedFrom} shutdownPending={controls.shutdownPending} shutdownNote={controls.shutdownNote} onShutdown={controls.shutdown} onBack={onBack} />
      {stale ? (
        <div className="shrink-0 px-3 pt-2">
          <SettingsNotice tone="error" testId="team-stale" onRetry={() => store.retryTeam(snap.id)} retryLabel={t("common.retry")}>
            <span className="font-semibold">{t("stale.title")}</span> {t("stale.hint")}
          </SettingsNotice>
        </div>
      ) : null}
      <TeamTabs tab={tab} onTab={setTab} counts={counts} />
      {TABS.map((id) => (
        <div key={id} role="tabpanel" id={tabPanelId(id)} aria-labelledby={tabId(id)} hidden={tab !== id} tabIndex={0} className="focus-ring min-h-0 flex-1 overflow-y-auto p-3" data-testid={`team-panel-${id}`}>
          {id === "members" ? (
            <MembersGrid snap={snap} notes={controls.notes} pending={controls.pendingStops} onStop={controls.stop} onFocusTask={focusTask} onShowMemberTasks={showMemberTasks} />
          ) : id === "tasks" ? (
            <TaskBoard snap={snap} ownerFilter={ownerFilter} onClearFilter={clearFilter} focus={focus} />
          ) : (
            <MessageLog snap={snap} />
          )}
        </div>
      ))}
    </div>
  );
}

export function TeamViewClaim({ params, onBack, store = teamsStore }: TeamViewProps): ReactElement {
  const t = useViewT();
  const sessionId = params.sessionId ?? "";
  const back = onBack ?? (() => undefined);
  const lookup = useSessionLookup(sessionId, store);
  const teamId = lookup?.teamId ?? undefined;
  const entry = useTeamEntry(teamId, store);
  const snapshot = entry?.snapshot;

  let body: ReactElement;
  if (snapshot) {
    body = <ReadyView snap={snapshot} stale={entry?.stale === true} sessionId={sessionId} store={store} onBack={back} />;
  } else if (!lookup || lookup.phase === "loading" || (lookup.phase === "resolved" && lookup.teamId && (!entry || entry.phase === "loading"))) {
    body = (
      <StateFrame onBack={back}>
        <Skeleton />
      </StateFrame>
    );
  } else if (lookup.phase === "error" || entry?.phase === "error") {
    body = (
      <StateFrame onBack={back}>
        <SettingsNotice tone="error" testId="team-error" onRetry={() => (lookup.phase === "error" ? store.retrySession(sessionId) : teamId && store.retryTeam(teamId))} retryLabel={t("common.retry")}>
          <span className="font-semibold">{t("error.title")}</span> {t("error.hint")}
        </SettingsNotice>
      </StateFrame>
    );
  } else if (entry?.phase === "not_found") {
    body = (
      <StateFrame onBack={back}>
        <Empty testId="team-not-found" title={t("notFound.title")} hint={t("notFound.hint")} />
      </StateFrame>
    );
  } else {
    // An empty lookup, or a team that never resolved: no existence oracle — the same "no team" copy.
    body = (
      <StateFrame onBack={back}>
        <Empty testId="team-none" title={t("none.title")} hint={t("none.hint")} />
      </StateFrame>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]" data-testid="team-root">
      <TeamsFeeder sessionId={sessionId} store={store} />
      {body}
      <LiveRegion snapshot={snapshot} />
    </div>
  );
}

