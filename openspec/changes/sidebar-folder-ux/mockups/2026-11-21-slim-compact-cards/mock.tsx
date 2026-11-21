// Live mock — slim compact folder cards (#1134, design D4).
// Proposed frames render the REAL SessionList (accordion mode, unfocused folder = compact)
// and the REAL FolderActionBanner. "Current" frames are hand-drawn from the pre-change
// markup: condensed header + Group-by chip row + `N sessions — click to view` row.
// Change: sidebar-folder-ux.

import { SessionList } from "@app/components/session/SessionList.tsx";
import { ThemeProvider } from "@app/components/settings/ThemeProvider.tsx";
import { FolderActionBanner } from "@app/components/folder/FolderActionBanner.tsx";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiFolder } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, type Fixtures, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const A = "/Users/dev/work/alpha";
const B = "/Users/dev/work/beta";

const mk = (id: string, cwd: string, over: Partial<DashboardSession> = {}): DashboardSession => ({
  id, cwd, name: `session ${id}`, source: "tui", status: "idle", startedAt: Date.now() - 60_000,
  tokensIn: 0, tokensOut: 0, cost: 0, ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => mk(`a${i}`, A));

const fixtures = (): Fixtures => ({
  http: { "GET /api/git/worktree/init-status": () => ({ hasHook: false }) },
});

function List({ sessions, groupBy }: { sessions: DashboardSession[]; groupBy?: boolean }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return (
    <Router hook={hook}>
      <ThemeProvider>
        <div className="w-[300px]">
          <SessionList
            sessions={sessions}
            selectedId="b1"
            onSelect={() => {}}
            pinnedDirectories={[A, B]}
            folderListMode="accordion"
            folderAttentionPeek
            groupByPrefs={groupBy ? { defaultGroupBy: "status", folderGroupBy: {}, collapsedLanes: [] } : undefined}
          />
        </div>
      </ThemeProvider>
    </Router>
  );
}

// ---- hand-drawn "current" (pre-change) compact card ----
const card = "w-[300px] rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5";
function OldHeader() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
      <Icon path={mdiFolder} size={0.5} />
      <span className="text-[var(--text-secondary)]">/Users/dev/work/</span>
      <span className="font-bold text-base">alpha</span>
    </div>
  );
}
function OldCompactEmpty({ n }: { n: number }) {
  return (
    <div className={card}>
      <OldHeader />
      <Issue n={1} tip="Group-by chip row repeated under a one-line header" block>
        <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">Status · default</div>
      </Issue>
      <Issue n={2} tip="Second row: muted count that only focuses" block>
        <div className="px-1 py-1 text-[11px] text-[var(--text-muted)]">{n} sessions — click to view</div>
      </Issue>
    </div>
  );
}

const noop = () => {};
const initNeeded = { hasHook: true, trusted: true, needsInit: true };
const Frame = ({ children }: { children: ReactNode }) => <div className={card}>{children}</div>;

const mock: Mock = {
  title: "Slim compact folder cards",
  category: "Sidebar",
  fixtures,
  frames: [
    {
      title: "Compact-empty folder, 18 sessions (accordion)", width: 320,
      why: "One header row: the count moves into the header as a muted button beside the name link; no Group-by row, no count row.",
      current: <OldCompactEmpty n={18} />,
      proposed: <Fix n={1} tip="Header row + count button only" block><List sessions={[...many(18), mk("b1", B)]} groupBy /></Fix>,
    },
    {
      title: "Compact-empty folder, 1 session", width: 320,
      why: "Singular accessible name (`1 session`); visible text is just `1`.",
      proposed: <List sessions={[mk("a0", A), mk("b1", B)]} />,
    },
    {
      title: "Focus mode: folder needs init", width: 320,
      why: "The Init-needed chip is informational; Focus is an explicit opt-in to a minimal sidebar, so no chip renders.",
      current: <Frame><OldHeader /><Issue n={3} tip="Chip shown in Focus" block><FolderActionBanner cwd={A} isProjectRoot status={initNeeded} compact /></Issue></Frame>,
      proposed: <Frame><OldHeader /><Fix n={2} tip="suppressChip while Focus is on" block><FolderActionBanner cwd={A} isProjectRoot status={initNeeded} compact suppressChip onStatusChange={noop} /></Fix></Frame>,
    },
  ],
};
export default mock;
