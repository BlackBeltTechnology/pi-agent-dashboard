// Explore-mode mock: a Refresh control for the editor-pane file-tree rail.
// Real EditorFileTree (fetches GET /api/file/tree per open dir, once on mount —
// no re-read today). Proposed chrome is drawn with the rail's own classes; the
// refresh itself is a remount (key bump) so open folders (treeOpenRoots) persist.
// Pending change: add editor file-tree refresh button.

import { EditorFileTree } from "@app/components/editor-pane/EditorFileTree.tsx";
import { mdiChevronDown, mdiChevronRight, mdiCollapseAllOutline, mdiContentCopy, mdiFolderOutline, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, type Fixtures, Issue, type Mock } from "mock-site/kit";
import { type ReactNode, useState } from "react";

const CWD = "/Users/dev/work/web-app";
const OPEN = ["src"];

// The agent wrote `src/billing-export.ts` after the tree was first read.
const base: Record<string, { name: string; isDir: boolean }[]> = {
  ".": [
    { name: ".pi", isDir: true }, { name: "docs", isDir: true }, { name: "src", isDir: true },
    { name: "AGENTS.md", isDir: false }, { name: "package.json", isDir: false }, { name: "README.md", isDir: false },
  ],
  src: [
    { name: "components", isDir: true }, { name: "app.tsx", isDir: false },
    { name: "auth.ts", isDir: false }, { name: "main.tsx", isDir: false },
  ],
};
const added = { name: "billing-export.ts", isDir: false };

/** Each pane gets its own counter: the 2nd+ read of `src` sees the new file. */
const fixtures = (): Fixtures => {
  const reads: Record<string, number> = {};
  return {
    http: {
      "GET /api/file/tree": (r) => {
        const p = r.url.searchParams.get("path") || ".";
        reads[p] = (reads[p] ?? 0) + 1;
        const entries = [...(base[p] ?? [])];
        if (p === "src" && reads[p] > 1) entries.splice(2, 0, added);
        return { success: true, data: { entries } };
      },
    },
  };
};
const freshFixtures = (): Fixtures => {
  const f = fixtures();
  const h = f.http!["GET /api/file/tree"];
  // Pre-warm: this pane already shows the post-refresh listing.
  return { http: { "GET /api/file/tree": (r) => { h(r); return h(r); } } };
};

const noop = () => {};
const Tree = ({ k = 0 }: { k?: number }) => (
  <EditorFileTree key={k} cwd={CWD} treeOpenRoots={OPEN} onToggleRoot={noop} onOpenFile={noop} activePath="src/auth.ts" sessionOnly />
);

// ---- rail chrome (classes copied from EditorPane.tsx rail tablist) ----
const tabCls = (on: boolean) =>
  `inline-flex min-h-6 items-center rounded px-2 text-xs font-medium ${on ? "bg-[var(--bg-selected)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`;
const iconBtn =
  "inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-blue)]";

function RefreshBtn({ spinning, onClick, testId = "tree-refresh" }: { spinning?: boolean; onClick?: () => void; testId?: string }) {
  return (
    <button type="button" data-testid={testId} className={iconBtn} aria-label="Refresh file tree" title="Refresh file tree" aria-busy={spinning || undefined} onClick={onClick}>
      <Icon path={mdiRefresh} size={0.6} spin={spinning ? 1 : false} />
    </button>
  );
}

function Tabs({ right }: { right?: ReactNode }) {
  return (
    <div role="tablist" aria-label="Rail view" className="flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] px-2 py-1">
      <button type="button" role="tab" aria-selected className={tabCls(true)}>Files</button>
      <button type="button" role="tab" aria-selected={false} className={tabCls(false)}>Search</button>
      {right ? <div className="ml-auto flex items-center gap-0.5">{right}</div> : null}
    </div>
  );
}

function ExplorerHeader({ spinning, onRefresh }: { spinning?: boolean; onRefresh?: () => void }) {
  return (
    <div className="group flex shrink-0 items-center gap-1 border-b border-[var(--border-primary)] py-0.5 pl-2 pr-1">
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]" title={CWD}>web-app</span>
      <RefreshBtn spinning={spinning} onClick={onRefresh} />
      <button type="button" className={iconBtn} aria-label="Collapse all folders" title="Collapse all folders">
        <Icon path={mdiCollapseAllOutline} size={0.6} />
      </button>
    </div>
  );
}

function Rail({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="flex h-[300px] w-[260px] min-h-0 flex-col bg-[var(--bg-secondary)]">
      {header}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/** Interactive option B: clicking Refresh remounts the real tree → re-reads open dirs. */
function LiveB() {
  const [k, setK] = useState(0);
  const [spin, setSpin] = useState(false);
  const refresh = () => { setSpin(true); setK((n) => n + 1); setTimeout(() => setSpin(false), 400); };
  return <Rail header={<><Tabs /><ExplorerHeader spinning={spin} onRefresh={refresh} /></>}><Tree k={k} /></Rail>;
}

// Static replica of one folder row (option C: per-folder hover refresh).
function FolderRowHover() {
  return (
    <div className="group relative flex items-center bg-[var(--bg-hover)] text-[var(--text-secondary)]">
      <div className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-2 text-left text-xs">
        <Icon path={mdiChevronDown} size={0.5} /><Icon path={mdiFolderOutline} size={0.55} /><span className="truncate">src</span>
      </div>
      <RefreshBtn testId="folder-refresh" />
      <span className={iconBtn}><Icon path={mdiContentCopy} size={0.5} /></span>
    </div>
  );
}
const FolderRowPlain = ({ name }: { name: string }) => (
  <div className="flex items-center gap-1 py-1 pl-2 text-xs text-[var(--text-secondary)]">
    <Icon path={mdiChevronRight} size={0.5} /><Icon path={mdiFolderOutline} size={0.55} /><span>{name}</span>
  </div>
);

const mock: Mock = {
  title: "Editor file tree - refresh button",
  category: "Editor pane",
  fixtures,
  frames: [
    {
      title: "Option A - icon in the Files/Search tab row", width: 300,
      why: "Zero new chrome: one icon at the tab row's end. Absent when the rail has no Search tab.",
      current: <Rail header={<Issue n={1} tip="No way to re-read the folder" block><Tabs /></Issue>}><Tree /></Rail>,
      proposed: <Rail header={<Fix n={1} tip="Refresh at row end, Files view only" block><Tabs right={<RefreshBtn />} /></Fix>}><Tree /></Rail>,
    },
    {
      title: "Option B - Explorer header (VS Code style)", width: 300,
      why: "Always-present header: folder name + Refresh + Collapse all. Works without the Search tab.",
      current: <Rail header={<Tabs />}><Tree /></Rail>,
      proposed: <Rail header={<><Tabs /><Fix n={2} tip="Header row: name, Refresh, Collapse" block><ExplorerHeader /></Fix></>}><Tree /></Rail>,
    },
    {
      title: "Option C - per-folder refresh on hover", width: 300,
      why: "Re-read one directory only. Discoverability low; pair with A or B for the root.",
      proposed: (
        <div className="w-[260px] bg-[var(--bg-secondary)] py-1">
          <FolderRowPlain name=".pi" /><FolderRowPlain name="docs" />
          <Fix n={3} tip="Hover row: refresh + copy" block><FolderRowHover /></Fix>
        </div>
      ),
    },
    {
      title: "Refresh flow (option B)", width: 300,
      why: "Open folders stay open; rows stay visible while reading; new file appears in place.",
      steps: [
        { label: "stale: agent added a file", proposed: <Rail header={<><Tabs /><ExplorerHeader onRefresh={noop} /></>}><Tree /></Rail> },
        { label: "reading (icon spins, rows kept)", proposed: <Rail header={<><Tabs /><ExplorerHeader spinning /></>}><Tree /></Rail> },
      ],
    },
    {
      title: "After refresh - new file listed", width: 300, fixtures: freshFixtures,
      why: "src/billing-export.ts now shows; expansion state unchanged.",
      proposed: <Rail header={<><Tabs /><ExplorerHeader /></>}><Fix n={4} tip="New file appears in place" block><Tree /></Fix></Rail>,
    },
    {
      title: "Option B - scripted (real remount)", width: 300,
      why: "Real click: key bump remounts EditorFileTree, each open dir re-fetches /api/file/tree.",
      proposed: <LiveB />,
      script: [
        { say: "Tree read once at mount", act: "wait", expect: (d) => !!d.querySelector('[data-row="src"]') },
        { say: "Click Refresh", target: "tree-refresh", act: "click", expect: (d) => d.body.textContent?.includes("billing-export.ts") ?? false },
      ],
    },
  ],
};
export default mock;
