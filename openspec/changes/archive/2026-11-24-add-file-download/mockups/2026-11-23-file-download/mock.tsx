// Live mock for change add-file-download: Download in the document bar ⋯ menu and
// the file-tree row actions menu (copy-path popup → row actions, right-click, touch).
// Current sides use the REAL DocumentBar / EditorFileTree; open menus are drawn
// (state changes are drawn, never clicked) with the exact MenuPopover / MenuItem /
// RowCopyAffordance classes. Toast is the real primitive, contained by a transform.
// See change: add-file-download (design D3, D4, D5).

import { DocumentBar } from "@app/components/editor-pane/DocumentBar.tsx";
import { EditorFileTree } from "@app/components/editor-pane/EditorFileTree.tsx";
import { Toast } from "@app/components/primitives/Toast.tsx";
import { fileIcon } from "@app/lib/preview/file-icon.ts";
import { mdiChevronDown, mdiChevronRight, mdiContentCopy, mdiDotsHorizontal, mdiDownload, mdiFolderOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, type Fixtures, Issue, type Mock, Tap } from "mock-site/kit";
import type { ReactNode } from "react";

const CWD = "/Users/dev/work/reports";
const FILE = "notes/summary.md";
const noop = () => {};

// ---- fixtures for the real EditorFileTree ----
const tree: Record<string, { name: string; isDir: boolean }[]> = {
  ".": [
    { name: "assets", isDir: true }, { name: "notes", isDir: true },
    { name: "AGENTS.md", isDir: false }, { name: "README.md", isDir: false },
  ],
  notes: [
    { name: "meeting-2026-11-20.md", isDir: false }, { name: "q4-report.pdf", isDir: false },
    { name: "summary.md", isDir: false },
  ],
};
const fixtures = (): Fixtures => ({
  http: {
    "GET /api/file/tree": (r) => ({ success: true, data: { entries: tree[r.url.searchParams.get("path") || "."] ?? [] } }),
  },
});

// ---- exact classes (MenuPopover.tsx, EditorFileTree.tsx RowCopyAffordance) ----
const MENU_PANEL =
  "min-w-[200px] overflow-hidden rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg";
const MENU_ITEM =
  "flex min-h-7 w-full items-center gap-2 whitespace-nowrap px-3 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:bg-[var(--bg-hover)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";
const COPY_POPUP =
  "min-w-[190px] overflow-hidden rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-lg";
const COPY_ITEM =
  "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]";
const GLYPH = "mr-1 rounded p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]";

/** Drawn MenuPopover panel. `hint` = proposed MenuItem.hint (muted second line). */
function Menu({ header, items }: { header?: string; items: { label: string; testId?: string; hint?: string; icon?: string }[] }) {
  return (
    <div role="menu" className={MENU_PANEL}>
      {header && (
        <div className="truncate border-b border-[var(--border-primary)] px-3 pb-1 text-[10px] text-[var(--text-tertiary)]" title={header}>
          {header}
        </div>
      )}
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" data-testid={it.testId} className={MENU_ITEM}>
          {it.icon && <Icon path={it.icon} size={0.55} className="shrink-0 text-[var(--text-tertiary)]" />}
          <span className="flex flex-1 flex-col">
            <span>{it.label}</span>
            {it.hint && <span className="text-[10px] text-[var(--text-tertiary)]">{it.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

const MORE_TODAY = [
  { label: "Show in file tree" }, { label: "Copy full path" }, { label: "Copy relative path" }, { label: "Copy file name" },
];
const MORE_NEXT = (hint?: string) => [...MORE_TODAY, { label: "Download", testId: "doc-download", icon: mdiDownload, hint }];

// ---- document bar (REAL component, closed) + drawn open menu under ⋯ ----
function Bar() {
  return (
    <DocumentBar
      tab={{ path: FILE, viewer: "markdown", addedAt: 0 } as never}
      cwd={CWD}
      narrow={false}
      systemOpen={false}
      claims={[]}
      selectedMode={undefined}
      outsideCwd={false}
      onSelectMode={noop}
      onReload={noop}
      onShowInTree={noop}
      onOpenFolder={noop}
    />
  );
}
function BarWithMenu({ menu }: { menu: ReactNode }) {
  return (
    <div className="w-[600px] bg-[var(--bg-primary)]">
      <Bar />
      <div className="flex justify-end px-2 pt-1 pb-3">{menu}</div>
      <div className="px-4 pb-4 text-xs text-[var(--text-tertiary)]"># Summary — Q4 review …</div>
    </div>
  );
}

// ---- file-tree rows (replica of FileRow / dir row markup) ----
function Row({ name, depth = 0, dir, open, hover, glyph }: { name: string; depth?: number; dir?: boolean; open?: boolean; hover?: boolean; glyph?: "copy" | "dots" | "dots-visible" }) {
  const pad = depth * 12 + 8;
  const icon = fileIcon(name);
  const glyphCls = `${GLYPH} ${hover || glyph === "dots-visible" ? "opacity-100" : "opacity-0"}`;
  return (
    <div data-row={name} className={`group relative flex items-center text-[var(--text-secondary)] ${hover ? "bg-[var(--bg-hover)]" : ""}`}>
      <span className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-xs" style={{ paddingLeft: dir ? pad : pad + 10 }}>
        {dir ? (
          <>
            <Icon path={open ? mdiChevronDown : mdiChevronRight} size={0.5} />
            <Icon path={mdiFolderOutline} size={0.55} />
          </>
        ) : (
          <Icon path={icon.iconPath} size={0.55} className={icon.colorClass} />
        )}
        <span className="truncate">{name}</span>
      </span>
      {glyph && (
        <span className={glyphCls} aria-label={glyph === "copy" ? "Copy path" : "Row actions"}>
          <Icon path={glyph === "copy" ? mdiContentCopy : mdiDotsHorizontal} size={0.55} />
        </span>
      )}
    </div>
  );
}

function Rail({ children, menu, w = 280 }: { children: ReactNode; menu?: ReactNode; w?: number }) {
  return (
    <div className="flex gap-2">
      <div className="bg-[var(--bg-secondary)] py-1" style={{ width: w }}>{children}</div>
      {menu && <div className="pt-[70px]">{menu}</div>}
    </div>
  );
}

const Tree = () => (
  <div className="h-[220px] w-[280px] overflow-hidden bg-[var(--bg-secondary)]">
    <EditorFileTree cwd={CWD} treeOpenRoots={["notes"]} onToggleRoot={noop} onOpenFile={noop} activePath={FILE} sessionOnly />
  </div>
);

const rowsWith = (hoverName: string, glyph: "copy" | "dots") => (
  <>
    <Row name="assets" dir glyph={glyph} />
    <Row name="notes" dir open hover={hoverName === "notes"} glyph={glyph} />
    <Row name="meeting-2026-11-20.md" depth={1} glyph={glyph} />
    <Row name="q4-report.pdf" depth={1} glyph={glyph} />
    <Row name="summary.md" depth={1} hover={hoverName === "summary.md"} glyph={glyph} />
    <Row name="AGENTS.md" glyph={glyph} />
  </>
);

const COPY3 = ["Copy full path", "Copy relative path", "Copy file name"];
const rowMenu = (rel: string, withDownload: boolean) => (
  <Menu
    header={`${CWD}/${rel}`}
    items={[
      ...COPY3.map((label) => ({ label })),
      ...(withDownload ? [{ label: "Download", testId: "tree-row-download", icon: mdiDownload }] : []),
    ]}
  />
);
const copyPopupToday = (
  <div className={COPY_POPUP}>
    <div className="truncate border-b border-[var(--border-primary)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">{`${CWD}/${FILE}`}</div>
    {COPY3.map((l) => (
      <div key={l} className={COPY_ITEM}>{l}</div>
    ))}
  </div>
);

// Toast is `position: fixed`; a transformed box becomes its containing block.
const ToastBox = () => (
  <div className="relative h-[110px] w-[420px] overflow-hidden rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] [transform:translateZ(0)]">
    <Toast
      messages={[{ id: 1, text: "Download failed: q4-report.pdf (403 — access not granted)", variant: "error", noAutoDismiss: true }]}
      onDismiss={noop}
    />
  </div>
);

const mock: Mock = {
  title: "File download - viewer menu + file tree",
  category: "Editor pane",
  change: "add-file-download",
  frames: [
    {
      title: "Document bar ⋯ menu - Download item",
      width: 640,
      why: "Viewer menu gains Download after the copy items (doc-download). Saves the on-disk file.",
      current: (
        <BarWithMenu menu={<Issue n={1} tip="No way to save the file" block><Menu items={MORE_TODAY} /></Issue>} />
      ),
      proposed: (
        <BarWithMenu menu={<Fix n={1} tip="Download item, icon + label" block><Menu items={MORE_NEXT()} /></Fix>} />
      ),
    },
    {
      title: "Document bar ⋯ menu - unsaved changes",
      width: 640,
      why: "Dirty tab: Download stays enabled, muted hint says the edits are not included.",
      proposed: (
        <BarWithMenu
          menu={<Fix n={2} tip="Hint: unsaved edits not included" block><Menu items={MORE_NEXT("Unsaved changes not included")} /></Fix>}
        />
      ),
    },
    {
      title: "File tree - today (real tree)",
      width: 320,
      fixtures,
      why: "Real EditorFileTree: hover a row to see today's copy glyph. Reference for the rows below.",
      proposed: <Tree />,
    },
    {
      title: "File tree - file row menu",
      width: 560,
      why: "Copy popup becomes a row actions menu (⋯) on MenuPopover; file rows add Download.",
      current: (
        <Rail menu={<Issue n={3} tip="Copy only, no Download" block>{copyPopupToday}</Issue>}>{rowsWith("summary.md", "copy")}</Rail>
      ),
      proposed: (
        <Rail menu={<Fix n={3} tip="Row actions + Download" block>{rowMenu(FILE, true)}</Fix>}>{rowsWith("summary.md", "dots")}</Rail>
      ),
    },
    {
      title: "File tree - folder row menu",
      width: 560,
      why: "Folders keep the three copy actions only. No folder / zip download.",
      proposed: <Rail menu={<Fix n={4} tip="Folders: copy only" block>{rowMenu("notes", false)}</Fix>}>{rowsWith("notes", "dots")}</Rail>,
    },
    {
      title: "Right-click / Shift+F10 flow",
      width: 480,
      why: "Right-click (or Shift+F10 on a focused row) opens the same menu; the file is not opened.",
      steps: [
        {
          label: "right-click summary.md",
          proposed: (
            <Rail w={220}>
              <Row name="notes" dir open glyph="dots" />
              <Tap><Row name="summary.md" depth={1} hover glyph="dots" /></Tap>
              <Row name="AGENTS.md" glyph="dots" />
            </Rail>
          ),
        },
        {
          label: "menu at the row glyph, focus on 1st item",
          proposed: (
            <div className="w-[220px]">
              <Rail w={220}>
                <Row name="notes" dir open glyph="dots" />
                <Row name="summary.md" depth={1} hover glyph="dots" />
                <Row name="AGENTS.md" glyph="dots" />
              </Rail>
              <div className="mt-1 flex justify-end">
                <Fix n={5} tip="Same menu, native menu suppressed" block>{rowMenu(FILE, true)}</Fix>
              </div>
            </div>
          ),
        },
      ],
    },
    {
      title: "Phone - glyph visible without hover",
      phone: true,
      why: "(hover: none): the ⋯ glyph is always shown so touch users can reach Download.",
      current: (
        <Issue n={6} tip="Hover-only glyph: unreachable by touch" block>
          <Rail w={340}>
            <Row name="notes" dir open glyph="copy" />
            <Row name="q4-report.pdf" depth={1} glyph="copy" />
            <Row name="summary.md" depth={1} glyph="copy" />
          </Rail>
        </Issue>
      ),
      proposed: (
        <Fix n={6} tip="Glyph always visible on touch" block>
          <Rail w={340}>
            <Row name="notes" dir open glyph="dots-visible" />
            <Row name="q4-report.pdf" depth={1} glyph="dots-visible" />
            <Row name="summary.md" depth={1} glyph="dots-visible" />
          </Rail>
        </Fix>
      ),
    },
    {
      title: "Download failed (fetch path)",
      width: 460,
      why: "Cross-origin / outside-folder downloads go through fetch; a 403/404 shows an error toast.",
      proposed: <Fix n={7} tip="Error toast, nothing saved" block><ToastBox /></Fix>,
    },
  ],
};
export default mock;
