// Explore-mode mock: Flows edit mode becomes a FOLDER (cwd) setting in the folder
// cog menu, tri-state like "Group sessions by" (Use default / On / Off), and the
// global Settings toggle shows which folders override it.
// Markup replicates the real class strings of:
//   packages/client/src/components/folder/FolderActionsMenu.tsx (panel, groups, menuitem, menuitemradio)
//   packages/dashboard-plugin-runtime/src/settings-fields.tsx (ToggleField switch)
//   packages/flows-plugin/src/client/FlowEditPopover.tsx (pencil popover items)
// The real FolderActionsMenu portals + positions `fixed` from its trigger, so it is drawn, not mounted.
import {
  mdiAccountMultiplePlus,
  mdiArchiveOutline,
  mdiCogOutline,
  mdiDeleteOutline,
  mdiFileDocumentOutline,
  mdiFolderCogOutline,
  mdiPencilOutline,
  mdiPlus,
  mdiRefresh,
  mdiSourceBranch,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock } from "mock-site/kit";
import type { ReactNode } from "react";

const CWD = "~/Projects/Pi-Packages/pi-agent-dashboard";

// ---- FolderActionsMenu replica -------------------------------------------------
function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      role="menu"
      className="min-w-[260px] w-[300px] overflow-hidden rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] py-1 shadow-lg"
    >
      {children}
    </div>
  );
}
function GroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{children}</div>;
}
function Item({ icon, label, badge }: { icon: string; label: string; badge?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full min-h-[44px] items-center gap-3 px-3 py-2 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <Icon path={icon} size={0.6} className="shrink-0" />
      <span className="truncate">{label}</span>
      {badge && <span className="ml-auto shrink-0 text-[10px] font-extrabold text-[var(--accent-orange-text)]">{badge}</span>}
    </button>
  );
}
function Radio({ label, checked, description }: { label: string; checked: boolean; description?: string }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className="flex w-full min-h-[44px] md:min-h-[30px] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <span
        aria-hidden="true"
        className={`inline-flex h-3 w-3 flex-none items-center justify-center rounded-full border-[1.5px] ${checked ? "border-[var(--accent-blue)]" : "border-[var(--text-muted)]"}`}
      >
        {checked && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-blue)]" />}
      </span>
      <span className="truncate">{label}</span>
      {description && <span className="ml-auto shrink-0 pl-2 text-[10px] text-[var(--text-muted)]">{description}</span>}
    </button>
  );
}
function Divider() {
  return <div aria-hidden="true" className="mx-1 my-1 h-px bg-[var(--border-subtle)]" />;
}

/** The folder header row the cog sits in, with the menu dropped under it. */
function FolderHeader({ menu }: { menu: ReactNode }) {
  return (
    <div className="w-[340px] flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2">
        <span className="text-sm font-semibold text-[var(--text-primary)] truncate">pi-agent-dashboard</span>
        <span className="text-xs text-[var(--text-tertiary)]">3</span>
        <span className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)]">
          <Icon path={mdiFolderCogOutline} size={0.7} />
        </span>
      </div>
      <div className="self-end">{menu}</div>
    </div>
  );
}

function MenuBody({ flows }: { flows?: ReactNode }) {
  return (
    <>
      <GroupLabel>Group sessions by</GroupLabel>
      <Radio label="Use default (Status)" checked description="default" />
      <Radio label="Status" checked={false} />
      <Radio label="Worktree" checked={false} />
      <Divider />
      <GroupLabel>Directory</GroupLabel>
      <Item icon={mdiSourceBranch} label="Manage worktrees" />
      <Item icon={mdiCogOutline} label="Directory Settings" />
      {flows}
      <GroupLabel>Create</GroupLabel>
      <Item icon={mdiPlus} label="New automation" />
      <GroupLabel>Open</GroupLabel>
      <Item icon={mdiArchiveOutline} label="OpenSpec archive" />
      <Item icon={mdiFileDocumentOutline} label="OpenSpec specs" />
      <GroupLabel>Maintenance</GroupLabel>
      <Item icon={mdiRefresh} label="Refresh folder" />
    </>
  );
}

function FlowsRadios({ v }: { v: "inherit" | "on" | "off" }) {
  return (
    <div role="group" aria-label="Flows edit mode">
      <Divider />
      <GroupLabel>Flows edit mode</GroupLabel>
      <Radio label="Use global default (on)" checked={v === "inherit"} description="global" />
      <Radio label="On for this folder" checked={v === "on"} description={v === "on" ? ".pi/settings.json" : undefined} />
      <Radio label="Off for this folder" checked={v === "off"} description={v === "off" ? ".pi/settings.json" : undefined} />
      <Divider />
    </div>
  );
}

// ---- Settings > General > Flows replica ---------------------------------------
function Switch({ on }: { on: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`relative h-[22px] w-10 shrink-0 rounded-full border ${on ? "border-[var(--accent-solid)] bg-[var(--accent-solid)]" : "border-[var(--border-strong)] bg-[var(--bg-tertiary)]"}`}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full ${on ? "translate-x-[18px] bg-white" : "translate-x-0 bg-[var(--text-secondary)]"}`} />
    </button>
  );
}
function FlowsSettings({ overrides }: { overrides?: ReactNode }) {
  return (
    <section className="w-[520px] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4 flex flex-col gap-3">
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">Flows</div>
        <div className="text-xs text-[var(--text-tertiary)]">Multi-agent workflows. This is the default for every session.</div>
      </div>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--text-primary)]">Edit mode</div>
          <div className="text-xs text-[var(--text-tertiary)]">
            Lets the main session create and change flows and agents. Saved to <code>~/.pi/agent/settings.json</code>; a
            folder's own setting wins.
          </div>
        </div>
        <span className="inline-flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-secondary)]">Off</span>
          <Switch on={false} />
        </span>
      </div>
      {overrides}
    </section>
  );
}
function OverrideList() {
  const rows = [
    { name: "pi-agent-dashboard", path: CWD, v: "On" },
    { name: "pi-flows", path: "~/Projects/Pi-Packages/pi-flows", v: "On" },
  ];
  return (
    <div className="rounded-lg border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] px-3 py-2 text-xs text-[var(--severity-info-fg)]">
      <div className="font-medium mb-1">2 folders override this</div>
      {rows.map((r) => (
        <div key={r.path} className="flex items-center gap-2 py-0.5">
          <span className="truncate" title={r.path}>{r.name}</span>
          <span className="font-semibold">{r.v}</span>
          <button type="button" className="ml-auto underline underline-offset-2">Use default</button>
        </div>
      ))}
    </div>
  );
}

// ---- Flows pencil popover replica ---------------------------------------------
function Pencil({ perProject }: { perProject: ReactNode }) {
  return (
    <Panel>
      <Item icon={mdiPencilOutline} label="Edit…" />
      <Item icon={mdiPlus} label="New flow…" />
      <Item icon={mdiDeleteOutline} label="Delete…" />
      {perProject}
    </Panel>
  );
}

const mock: Mock = {
  title: "Flows edit mode - folder setting",
  category: "Flows",
  frames: [
    {
      title: "Folder cog menu",
      width: 760,
      why: "Edit mode is stored per cwd, so it belongs in the folder menu, next to Group sessions by.",
      current: (
        <FolderHeader
          menu={
            <Issue n={1} tip="No flows control for the folder">
              <Panel>
                <MenuBody />
              </Panel>
            </Issue>
          }
        />
      ),
      proposed: (
        <FolderHeader
          menu={
            <Panel>
              <MenuBody
                flows={
                  <Fix n={1} tip="Tri-state, like Group by" block>
                    <FlowsRadios v="on" />
                  </Fix>
                }
              />
            </Panel>
          }
        />
      ),
    },
    {
      title: "Folder cog menu - states",
      width: 1000,
      why: "Use default removes the key; On / Off pin the folder. Description says where the value comes from.",
      steps: [
        { label: "inherits global", proposed: <Panel><FlowsRadios v="inherit" /></Panel> },
        { label: "pinned on", proposed: <Panel><FlowsRadios v="on" /></Panel> },
        { label: "pinned off", proposed: <Panel><FlowsRadios v="off" /></Panel> },
      ],
    },
    {
      title: "Settings > General > Flows",
      width: 1140,
      why: "Turning the global switch off looked like it did nothing: this folder silently overrode it.",
      current: (
        <Issue n={2} tip="Override is invisible">
          <FlowsSettings />
        </Issue>
      ),
      proposed: (
        <FlowsSettings
          overrides={
            <Fix n={2} tip="Lists overriding folders" block>
              <OverrideList />
            </Fix>
          }
        />
      ),
    },
    {
      title: "Flows chip pencil popover",
      width: 760,
      why: "One place to change it: the session-level per-project item goes; the popover only says where it comes from.",
      current: (
        <Pencil
          perProject={
            <Issue n={3} tip="Hidden per-session toggle">
              <Item icon={mdiAccountMultiplePlus} label="Turn off edit mode for this project" />
            </Issue>
          }
        />
      ),
      proposed: (
        <Pencil
          perProject={
            <Fix n={3} tip="Read-only source note" block>
              <div className="px-3 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
                Edit mode on (this folder). Change it in the folder menu.
              </div>
            </Fix>
          }
        />
      ),
    },
  ],
};
export default mock;
