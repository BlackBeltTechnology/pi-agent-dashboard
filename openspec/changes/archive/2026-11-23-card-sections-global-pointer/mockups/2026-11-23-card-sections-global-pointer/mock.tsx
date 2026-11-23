// Explore-mode live mock: the per-folder "Session cards" page should POINT to the
// global defaults, so users don't confuse the two scopes.
// Current = the shipped CardSectionsPage (Directory Settings › Session cards), the
// shipped CardSectionsSection (Settings › General) and the real session actions
// panel (VIEW group from deriveSessionMenu). Proposed = a fork of CardSectionsPage
// that differs ONLY in the ringed parts:
//   1. scope strip names the global source + "Edit global defaults" deep link
//   2. tri-state "Default (Show)" reads "Global (Show)" (same word as "Reset to global")
//   3. session menu VIEW group keeps ONE entry, "Card sections…" (global reached via 1)
// Fixture prefs follow the real CardSectionPrefs shape (shared/card-sections.ts).

import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  type CardSectionPrefs,
  cardSectionFolderKey,
  getFolderOverride,
  resolveCardSectionVisible,
} from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { CardSectionsPage } from "@app/components/DirectorySettings/CardSectionsPage.tsx";
import { SessionActionsPanel } from "@app/components/session/SessionActionsPanel.tsx";
import { CardSectionsSection } from "@app/components/settings/CardSectionsSection.tsx";
import { FocusNotice } from "@app/components/settings/FocusNotice.tsx";
import { t as i18nT } from "@app/lib/i18n/i18n.tsx";
import { type CardSectionGroup, type CardSectionMeta, useOfferedCardSections } from "@app/lib/session/card-section-meta.ts";
import { deriveSessionMenu, type SessionMenuCtx } from "@app/lib/session/session-menu-items.ts";
import { CardSectionsProvider, useCardSectionActions, useCardSectionPrefs } from "@app/lib/state/CardSectionsContext.tsx";
import { Fix, Issue, type Mock } from "mock-site/kit";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

// ---- fixture prefs: GIT hidden globally; this folder overrides TAGS (hide) + GIT (show) ----
const CWD = "/Users/bmiller/Projects/Pi-Packages/pi-agent-dashboard";
const KEY = cardSectionFolderKey(CWD);
const START: CardSectionPrefs = { global: { git: false }, folders: { [KEY]: { tags: false, git: true } } };

/** Stateful stand-in for the server: applies the two WS messages the pages send. */
function LivePrefs({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<CardSectionPrefs>(START);
  const send = useCallback((msg: BrowserToServerMessage) => {
    setPrefs((p) => {
      const next: CardSectionPrefs = { global: { ...p.global }, folders: { ...p.folders } };
      if (msg.type === "reset_folder_card_sections") {
        delete next.folders![cardSectionFolderKey(msg.path)];
      } else if (msg.type === "set_card_section_visibility") {
        const path = "path" in msg ? msg.path : undefined;
        const map = path === undefined ? next.global! : { ...(next.folders![cardSectionFolderKey(path)] ?? {}) };
        if (msg.visible === null) delete map[msg.section];
        else map[msg.section] = msg.visible;
        if (path !== undefined) next.folders![cardSectionFolderKey(path)] = map;
      }
      return next;
    });
  }, []);
  return <CardSectionsProvider value={{ prefs, send, connected: true }}>{children}</CardSectionsProvider>;
}

function Ring({ on, n, tip, block, children }: { on: boolean; n: number; tip: string; block?: boolean; children: ReactNode }) {
  return on ? <Fix n={n} tip={tip} block={block}>{children}</Fix> : <>{children}</>;
}

// ---- Proposed fork of CardSectionsPage (exact markup; only ringed parts differ) ----
type TriState = "inherit" | "show" | "hide";
function groupTitle(g: CardSectionGroup): string {
  if (g === "builtin") return i18nT("cardSections.groupSections", undefined, "Sections");
  if (g === "plugin") return i18nT("cardSections.groupPlugin", undefined, "Plugin sections");
  if (g === "directory") return i18nT("cardSections.groupDirectory", undefined, "Directory card");
  if (g === "effects") return i18nT("cardSections.groupEffects", undefined, "Effects");
  return i18nT("cardSections.groupLines", undefined, "Card lines");
}

function ProposedCardSectionsPage({ cwd, onOpenGlobal, ringed = true }: { cwd: string; onOpenGlobal: () => void; ringed?: boolean }) {
  const prefs = useCardSectionPrefs();
  const actions = useCardSectionActions();
  const offered = useOfferedCardSections().filter((m) => !m.globalOnly);
  const key = cardSectionFolderKey(cwd);
  const overrideCount = Object.keys(prefs.folders?.[key] ?? {}).length;
  let firstRow = true;

  const row = (m: CardSectionMeta) => {
    const override = getFolderOverride(prefs, key, m.id);
    const folderMap = { ...(prefs.folders?.[key] ?? {}) };
    delete folderMap[m.id];
    const globalVisible = resolveCardSectionVisible({ global: prefs.global, folders: { [key]: folderMap } }, key, m.id);
    const value: TriState = override === null ? "inherit" : override ? "show" : "hide";
    const label = m.label();
    const options: { v: TriState; text: string; send: boolean | null }[] = [
      { v: "inherit", text: globalVisible ? "Global (Show)" : "Global (Hide)", send: null },
      { v: "show", text: i18nT("cardSections.show", undefined, "Show"), send: true },
      { v: "hide", text: i18nT("cardSections.hide", undefined, "Hide"), send: false },
    ];
    const ringThis = ringed && firstRow;
    firstRow = false;
    const control = (
      <fieldset aria-label={label} className="inline-flex rounded-md border border-[var(--border-secondary)] overflow-hidden">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            aria-pressed={value === o.v}
            disabled={!actions.canWrite}
            data-testid={`card-section-${m.id}-${o.v}`}
            onClick={() => {
              if (value !== o.v) actions.setVisibility(cwd, m.id, o.send);
            }}
            className={`px-2.5 min-h-[28px] text-xs border-l first:border-l-0 border-[var(--border-secondary)] focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${
              value === o.v ? "bg-blue-600/15 text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {o.text}
          </button>
        ))}
      </fieldset>
    );
    return (
      <div
        key={m.id}
        data-testid={`card-section-row-${m.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 border-b last:border-b-0 border-[var(--border-subtle)]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            {label}
            {override !== null && (
              <span className="text-[10px] font-medium px-1.5 rounded-full bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]">
                {i18nT("cardSections.overridden", undefined, "overridden")}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {m.description()}
            {m.id === "openspec" && (
              <>
                {" "}
                {i18nT("cardSections.openspecNotDisabled", undefined, "Hiding does not disable OpenSpec.")}{" "}
                <button type="button" className="underline text-[var(--accent-primary)] hover:text-[var(--text-primary)]">
                  {i18nT("cardSections.openspecOptOutLink", undefined, "Manage OpenSpec opt-outs…")}
                </button>
              </>
            )}
          </p>
        </div>
        {ringThis ? <Fix n={2} tip="'Global (…)' names where the default comes from">{control}</Fix> : control}
      </div>
    );
  };

  const groups: CardSectionGroup[] = ["builtin", "plugin", "lines", "directory"];
  return (
    <div className="p-4 md:p-6 flex flex-col lg:flex-row gap-6" data-testid="card-sections-page">
      <div className="flex-1 min-w-0 max-w-2xl">
        <h2 className="text-base font-bold text-[var(--text-primary)]">{i18nT("cardSections.pageTitle", undefined, "Session cards")}</h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1 mb-4">
          {i18nT(
            "cardSections.pageLead",
            { folder: cwd },
            "Choose which sections appear on session cards in {folder} (and its worktrees). Applies on every device. Sections with nothing to show still hide automatically.",
          )}
        </p>
        <FocusNotice />
        <Ring on={ringed} n={1} tip="Names the global source + one-click way there" block>
          <div className="flex items-center gap-3 px-3 py-2.5 mb-4 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
            <span className="flex-1 text-xs text-[var(--text-secondary)]" data-testid="card-sections-override-summary">
              {overrideCount === 0
                ? "Following the global defaults — no overrides for this folder."
                : `${overrideCount} override(s) for this folder; everything else follows the global defaults.`}
            </span>
            <button
              type="button"
              data-testid="card-sections-open-global"
              onClick={onOpenGlobal}
              className="text-xs px-2.5 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-ring"
            >
              Edit global defaults →
            </button>
            <button
              type="button"
              data-testid="card-sections-reset"
              disabled={overrideCount === 0 || !actions.canWrite}
              onClick={() => actions.resetFolder(cwd)}
              className="text-xs px-2.5 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed focus-ring"
            >
              {i18nT("cardSections.resetToGlobal", undefined, "Reset to global")}
            </button>
          </div>
        </Ring>
        {groups.map((g) => {
          const items = offered.filter((m) => m.group === g);
          if (items.length === 0 && g !== "lines") return null;
          return (
            <section key={g} aria-label={groupTitle(g)} className="mb-4 rounded-lg border border-[var(--border-subtle)]">
              <h3 className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                {groupTitle(g)}
              </h3>
              {items.map(row)}
              {g === "lines" && (
                <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{i18nT("settings.contextUsageBar", undefined, "Context usage bar")}</div>
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {i18nT("cardSections.contextBarNote", undefined, "Governed by the global chat display preference.")}
                    </p>
                  </div>
                  <button type="button" className="text-xs underline text-[var(--accent-primary)] hover:text-[var(--text-primary)]">
                    {i18nT("cardSections.openDisplaySettings", undefined, "Open display settings")}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <CardSectionsPreview prefs={prefs} folderKey={key} offered={offered} />
    </div>
  );
}

/** Verbatim copy of the page's private preview aside (unchanged; keeps R3 parity). */
function CardSectionsPreview({ prefs, folderKey, offered }: { prefs: CardSectionPrefs; folderKey: string; offered: readonly CardSectionMeta[] }) {
  const on = (id: string) => resolveCardSectionVisible(prefs, folderKey, id);
  const capsules = offered.filter((m) => (m.group === "builtin" || m.group === "plugin") && on(m.id));
  return (
    <aside className="lg:w-72 shrink-0" aria-label={i18nT("cardSections.previewTitle", undefined, "Live preview")}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
        {i18nT("cardSections.previewTitle", undefined, "Live preview")}
      </h3>
      <div aria-hidden="true" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2.5 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="font-semibold text-[var(--text-primary)] flex-1 truncate">
            {i18nT("cardSections.previewSession", undefined, "Example session")}
          </span>
        </div>
        {on("spawn") && (
          <div className="flex gap-1 mt-1">
            <span className="text-[9px] px-1 rounded border border-green-500/30 text-green-400">+ {i18nT("session.session", undefined, "Session")}</span>
            <span className="text-[9px] px-1 rounded border border-orange-500/30 text-orange-400">+ {i18nT("worktree.worktree", undefined, "Worktree")}</span>
          </div>
        )}
        {on("tags") && <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">#ui #apply</div>}
        {capsules.map((m) => (
          <div key={m.id} className="relative mt-2 rounded-lg border border-[var(--border-subtle)] px-2 pt-2 pb-1 text-[var(--text-tertiary)]">
            <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[9px] font-semibold uppercase tracking-wider leading-none">
              {m.label()}
            </span>
            <span className="block h-1.5 w-2/3 rounded bg-[var(--bg-tertiary)]" />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">
        {i18nT("cardSections.previewNote", undefined, "Synthetic session with every section populated. Real cards still hide empty sections.")}
      </p>
    </aside>
  );
}

// ---- current page: the shipped component; issue rings sit on wrappers (its markup is untouched) ----
/** Overlays an Issue ring on an element inside the shipped component, located by selector. */
function IssueOver({ sel, up = false, n, tip, children }: { sel: string; up?: boolean; n: number; tip: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const hit = host.current?.querySelector(sel);
      const el = up ? hit?.parentElement : hit;
      if (!host.current || !el) return;
      const h = host.current.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setBox({ top: r.top - h.top, left: r.left - h.left, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, [sel, up]);
  return (
    <div ref={host} className="relative">
      {children}
      {box && (
        <div className="absolute pointer-events-none" style={box}>
          <Issue n={n} tip={tip} block>
            <div style={{ height: box.height }} />
          </Issue>
        </div>
      )}
    </div>
  );
}

function CurrentPage() {
  return (
    <IssueOver sel="[data-testid=card-sections-override-summary]" up n={1} tip="Says 'global defaults' but no way to reach them">
      <IssueOver sel="[data-testid=card-section-row-openspec] fieldset" n={2} tip="'Default' doesn't say whose default">
        <CardSectionsPage cwd={CWD} />
      </IssueOver>
    </IssueOver>
  );
}

// ---- session actions panel, real component, VIEW group derived from today's code ----
const SESSION = {
  id: "mock-session-1",
  cwd: CWD,
  status: "idle",
  isGitRepo: true,
  gitBranch: "develop",
  sessionFile: "/tmp/mock.jsonl",
} as unknown as DashboardSession;
const noop = () => {};
const CTX: SessionMenuCtx = {
  working: false, mergeIsPrimary: false, isHidden: false, showSpawn: true, canRename: true, canArchive: true, canExit: true,
  openspecWired: false, changes: undefined, wf: () => false, resolution: null, canBulkArchive: false, dirtyCount: 0,
  actions: {
    openDialog: noop, sendSkill: noop, detach: noop, navigate: noop, push: noop, openPr: noop, openUrl: noop,
    openCardSections: noop, openCardDefaults: noop, rename: noop, spawnSibling: noop, spawnWorktree: noop,
  },
};
function viewOnly(proposed: boolean) {
  const view = deriveSessionMenu(SESSION, CTX).filter((g) => g.id === "view");
  return proposed ? view.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== "card-defaults") })) : view;
}
function MenuStage({ proposed }: { proposed: boolean }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const Ringer = proposed ? Fix : Issue;
  return (
    <div className="h-[200px] p-4 bg-[var(--bg-primary)]">
      <div ref={cardRef} className="w-[260px] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
        <div className="font-semibold text-[var(--text-primary)]">pi-agent-dashboard</div>
        <div className="text-[var(--text-tertiary)]">develop · idle</div>
      </div>
      <div className="absolute left-[300px] top-4">
        <Ringer n={3} tip={proposed ? "One entry; global is one click further, inside" : "Two look-alike entries, scope unclear"} block>
          <div className="relative w-[240px] h-[120px] [&_[role=menu]]:!static [&_[role=menu]]:!transform-none">
            {ready && (
              <SessionActionsPanel
                session={SESSION}
                panelRef={panelRef}
                triggerRef={triggerRef}
                cardRef={cardRef}
                groups={viewOnly(proposed)}
                close={noop}
                label="Session actions"
                source="hover"
              />
            )}
          </div>
        </Ringer>
      </div>
    </div>
  );
}

// ---- flow: folder page -> Edit global defaults -> lands on the global block ----
function FlowStage() {
  // Real app: navigate() pushes history, so browser Back is the way back; the
  // script simply restarts from the folder page each loop.
  const [where, setWhere] = useState<"folder" | "global">("folder");
  if (where === "folder") return <ProposedCardSectionsPage cwd={CWD} onOpenGlobal={() => setWhere("global")} ringed={false} />;
  return (
    <div className="p-4 md:p-6 max-w-2xl" data-testid="global-landing">
      <p className="mb-3 text-xs text-[var(--text-tertiary)]">
        Settings › General, scrolled to Session card sections. Browser Back returns to the folder page.
      </p>
      <div className="rounded-lg ring-2 ring-[var(--accent-primary)] ring-offset-2 ring-offset-[var(--bg-primary)] p-3">
        <CardSectionsSection />
      </div>
    </div>
  );
}

const PAGE = "bg-[var(--bg-primary)]";
const WIDTH = 1040;

const mock: Mock = {
  title: "Session cards - folder page points to global defaults",
  category: "Settings",
  frames: [
    {
      title: "Directory Settings › Session cards",
      width: WIDTH,
      why: "Folder page names the global defaults and links there; 'Default' becomes 'Global' to match 'Reset to global'.",
      current: <LivePrefs><div className={PAGE}><CurrentPage /></div></LivePrefs>,
      proposed: <LivePrefs><div className={PAGE}><ProposedCardSectionsPage cwd={CWD} onOpenGlobal={noop} /></div></LivePrefs>,
    },
    {
      title: "Session actions menu › View",
      width: 600,
      why: "Two look-alike entries collapse to one; the folder page is the single entry point.",
      current: <MenuStage proposed={false} />,
      proposed: <MenuStage proposed />,
    },
    {
      title: "Flow - folder page to global defaults",
      width: WIDTH,
      why: "One click from the folder page lands on the global block, scrolled into view.",
      proposed: <LivePrefs><div className={PAGE}><FlowStage /></div></LivePrefs>,
      script: [
        { say: "Folder page: GIT overridden to Show here, hidden globally", act: "wait", target: "card-sections-open-global" },
        { say: "Edit global defaults", target: "card-sections-open-global", act: "click" },
        { say: "Lands on Settings › Session card sections (Back returns)", act: "wait", target: "global-landing" },
      ],
    },
  ],
};
export default mock;
