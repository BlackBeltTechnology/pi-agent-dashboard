// Add-ons Installed tab declutter + "what is this made of" (plugin / bridge / pi package).
// Current = real AddonFeatureRow + AddonsExplainer fed with fixture features.
// Proposed = drawn row/toolbar using dashboard tokens only.
// Pending change: declutter add-ons installed tab and show plugin-package relation.
import type { AddonFeature, AddonPackagePart } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { AddonFeatureRow } from "@app/components/packages/AddonFeatureRow.tsx";
import { AddonsExplainer } from "@app/components/packages/AddonsExplainer.tsx";
import { mdiChevronDown, mdiChevronRight, mdiMagnify } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Mock } from "mock-site/kit";

// ---- fixtures ----
const pkg = (source: string, version: string, c: Partial<AddonPackagePart["contents"]> = {}, extra: Partial<AddonPackagePart> = {}): AddonPackagePart => ({
  source, scope: "user", identity: source.replace(/^npm:/, ""), sourceKind: source.startsWith("npm:") ? "npm" : "local",
  packageName: source.replace(/^npm:/, ""), version, entryOff: false,
  contents: { extensions: 0, skills: 0, prompts: 0, themes: 0, ...c }, ...extra,
});
const plugin = (id: string, enabled = true, error?: string) => ({ id, enabled, loaded: enabled && !error, error, hasSettings: true, missingRequirements: [], dependsOn: [] });
const base = { authorLabels: [] as string[], requires: [], requiredBy: [] as string[] };

const F: Record<string, AddonFeature> = {
  bridge: { ...base, id: "core:dashboard-bridge", displayName: "pi-dashboard bridge", description: "Pi bridge extension for pi-dashboard",
    kind: "core", origin: "first-party", state: "on",
    packages: [pkg("/Users/me/Projects/pi-agent-dashboard/packages/extension", "0.11.0", { extensions: 1, skills: 11 }, { sourceKind: "local", packageName: "@blackbelt-technology/pi-dashboard-extension" })] },
  apple: { ...base, id: "plugin:apple-tools", displayName: "Apple Tools", kind: "agent-and-dashboard", origin: "first-party", state: "on",
    description: "Provision and surface iMCP (Apple Calendar, Contacts, Reminders, Messages, Location, Maps, Weather) for pi. One-command installer, a dashboard provisioning panel, and an agent skill. macOS-only; no Apple Mail.",
    plugin: plugin("apple-tools"), packages: [pkg("npm:@blackbelt-technology/pi-dashboard-apple-tools", "0.11.0", { skills: 1 })] },
  blackhole: { ...base, id: "plugin:blackhole", displayName: "Blackhole", kind: "agent-and-dashboard", origin: "mixed", authorLabels: ["pi-blackhole"], state: "on",
    description: "Unified compaction + observational memory extension for Pi — compresses conversation context while preserving durable observations and reflections",
    plugin: plugin("blackhole"), packages: [pkg("npm:pi-blackhole", "0.5.17", { extensions: 1 })] },
  ctx: { ...base, id: "plugin:context-mode", displayName: "context-mode Settings", kind: "agent-and-dashboard", origin: "mixed", authorLabels: ["context-mode"], state: "on",
    description: "Context-window saver: sandboxed code execution over large outputs, an FTS5 knowledge base, and intent-driven search. Processes big logs and files in a sandbox so only summaries reach the model context.",
    plugin: plugin("context-mode"), bridge: { path: "context-mode/bridge" }, packages: [pkg("npm:context-mode", "1.0.169", { extensions: 1, skills: 8 })] },
  goal: { ...base, id: "plugin:goal", displayName: "Goal", kind: "agent-and-dashboard", origin: "mixed", authorLabels: ["@ricoyudog"], state: "off",
    description: "Long-running goals with checkpoints.", plugin: plugin("goal", false), bridge: { path: "goal/bridge" },
    packages: [pkg("npm:@ricoyudog/pi-goal-hermes", "1.4.0", { extensions: 1 }, { entryOff: true })] },
};
const ROWS = [F.bridge, F.apple, F.blackhole, F.ctx, F.goal];
const noop = () => {};
const updates = new Set(["npm:pi-blackhole"]);

// ---- CURRENT: real components, rebuilt chrome around them ----
const chip = "text-xs px-2 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]";
function CurrentPage() {
  return (
    <div className="bg-[var(--bg-primary)] p-4 text-[var(--text-primary)] flex flex-col gap-3">
      <Issue n={1} tip="Help twice, legend, status button" block>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Add-ons</h2><button className={chip}>Checking…</button></div>
          <p className="text-xs text-[var(--text-secondary)]">Extensions, skills and plugins that your pi and this dashboard load. <a className="text-[var(--link)]">What are extensions and plugins?</a></p>
          <AddonsExplainer features={ROWS} expanded={false} onToggle={noop} toggleRef={{ current: null }} />
        </div>
      </Issue>
      <div className="flex gap-4 text-sm border-b border-[var(--border-primary)]">
        <span className="pb-1 border-b-2 border-[var(--accent)]">Installed (45)</span><span>Updates (0)</span><span>Discover</span><span>Issues (1)</span>
      </div>
      <Issue n={2} tip="Banner doesn't say which add-on" block>
        <div className="flex justify-between rounded border border-[var(--border-secondary)] px-3 py-2 text-xs">1 add-ons run from local source instead of a published version. <a className="text-[var(--link)]">Show</a></div>
      </Issue>
      <Issue n={3} tip="Filters spread over three rows" block>
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap gap-2 items-center"><span className="text-[var(--text-tertiary)]">Delivered by</span>
            {["pi-dashboard 39", "dashboard UI + community extension 3", "community 3", "pi core 1"].map((s) => <span key={s} className={chip}>{s}</span>)}</div>
          <div className="self-end text-[var(--text-tertiary)]">Group by <span className={chip}>by kind ▾</span></div>
          <div className="flex flex-wrap gap-2"><span className={`${chip} w-40 bg-[var(--bg-tertiary)]`}>Filter installed add-ons</span>
            {["Local source", "From pi-dashboard", "Community", "Has dashboard UI", "Agent only", "Disabled"].map((s) => <span key={s} className={chip}>{s}</span>)}</div>
        </div>
      </Issue>
      <div className="text-xs font-semibold text-[var(--text-tertiary)]">CORE</div>
      <Issue n={4} tip="Empty-state text above a real row" block><div className="text-xs italic text-[var(--text-tertiary)]">No pi ecosystem core packages detected.</div></Issue>
      {ROWS.map((f, i) => {
        const row = <AddonFeatureRow key={f.id} feature={f} updates={updates} statusFor={() => "idle"} toggling={false} locked={false} lockedReason=""
          onToggle={noop} onUpdate={noop} onUninstall={noop} onMove={noop} onResetToPublished={noop} featureName={(id) => id} />;
        if (i === 3) return <Issue key={f.id} n={5} tip="Plugin + package look like 2 things" block>{row}</Issue>;
        if (i === 1) return <div key={f.id}><div className="text-xs font-semibold text-[var(--text-tertiary)] mb-1">AGENT + DASHBOARD FEATURES</div>{row}</div>;
        return row;
      })}
    </div>
  );
}

// ---- PROPOSED (v2: progressive disclosure) ----
// Collapsed row = name + at most ONE status badge + one-line description + switch.
// Everything else (who made it, version, what it adds, parts, actions) lives in the expanded row.
type Part = { kind: string; name: string; ver?: string };
type Row = { f: AddonFeature; by?: string; status?: "issue" | "update" | "local"; statusText?: string; adds: string; parts: Part[]; open?: boolean; action?: string };
const R: Row[] = [
  { f: F.bridge, status: "local", adds: "pi: extension, 11 skills", action: "Reset to published",
    parts: [{ kind: "pi package", name: "@blackbelt-technology/pi-dashboard-extension", ver: "0.11.0 · local source" }] },
  { f: F.apple, adds: "pi: 1 skill · dashboard: setup panel",
    parts: [{ kind: "Dashboard plugin", name: "apple-tools" }, { kind: "pi package", name: "@blackbelt-technology/pi-dashboard-apple-tools", ver: "0.11.0" }] },
  { f: F.blackhole, by: "pi-blackhole", status: "update", statusText: "Update available", adds: "pi: extension · dashboard: settings page",
    parts: [{ kind: "Dashboard plugin", name: "blackhole" }, { kind: "pi package", name: "pi-blackhole", ver: "0.5.17" }] },
  { f: { ...F.ctx, displayName: "context-mode" }, by: "context-mode", open: true, adds: "pi: extension, 8 skills · dashboard: settings page",
    parts: [{ kind: "Dashboard plugin", name: "context-mode" }, { kind: "Bridge", name: "context-mode bridge" }, { kind: "pi package", name: "context-mode", ver: "1.0.169" }] },
  { f: F.goal, by: "@ricoyudog", status: "issue", statusText: "Needs attention", adds: "pi: extension · dashboard: goal panel",
    parts: [{ kind: "Dashboard plugin", name: "goal" }, { kind: "Bridge", name: "goal bridge" }, { kind: "pi package", name: "@ricoyudog/pi-goal-hermes", ver: "1.4.0" }] },
];

const WARN = "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]";
const ERR = "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]";
const INFO = "border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]";
const STATUS = { issue: ERR, update: INFO, local: WARN } as const;

function Switch({ on }: { on: boolean }) {
  return <span role="switch" aria-checked={on} className={`relative inline-block w-8 h-[18px] shrink-0 rounded-full ${on ? "bg-[var(--accent-solid)]" : "bg-[var(--bg-surface)]"}`}>
    <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow ${on ? "left-[16px]" : "left-[2px]"}`} /></span>;
}

function Details({ r }: { r: Row }) {
  return (
    <div className="mt-2 rounded-lg bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
      <div>Adds to {r.adds}{r.by ? <> · by {r.by}</> : null}</div>
      <div className="mt-2 text-[var(--text-tertiary)]">One switch turns these {r.parts.length} parts on or off together:</div>
      <ul className="mt-1 space-y-0.5">
        {r.parts.map((p) => (
          <li key={p.kind + p.name} className="flex flex-wrap gap-x-2">
            <span className="w-28 shrink-0 text-[var(--text-tertiary)]">{p.kind}</span>
            <code className="text-[var(--text-primary)]">{p.name}</code>
            {p.ver && <span className="text-[var(--text-tertiary)]">{p.ver}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-3"><a className="text-[var(--link)]">Settings</a><a className="text-[var(--link)]">Readme</a><a className="text-[var(--link)]">Uninstall</a></div>
    </div>
  );
}

function ProposedRow({ r, ring }: { r: Row; ring?: boolean }) {
  const { f } = r;
  const on = f.state === "on" || f.kind === "core";
  const badge = r.status && (
    <span className={`text-[11px] px-1.5 rounded border ${STATUS[r.status]}`}>{r.statusText ?? r.status}</span>
  );
  return (
    <div className="px-4 py-2.5 border-t border-[var(--border-subtle)]">
      <div className="flex items-center gap-3">
        <Icon path={r.open ? mdiChevronDown : mdiChevronRight} size={0.6} className="shrink-0 text-[var(--text-tertiary)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">{f.displayName}{badge}</div>
          <div className="text-xs text-[var(--text-tertiary)] truncate">{f.description}</div>
        </div>
        {r.action && <a className="text-xs text-[var(--link)] shrink-0">{r.action}</a>}
        {f.kind === "core" ? <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">Required</span> : <Switch on={on} />}
      </div>
      {r.open && <div className="pl-7">{ring ? <Fix n={5} tip="Expand shows what it is made of" block><Details r={r} /></Fix> : <Details r={r} />}</div>}
    </div>
  );
}

function Toolbar() {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="flex-1 flex items-center gap-2 rounded-lg border border-[var(--border-secondary)] px-2 py-1 text-xs text-[var(--text-tertiary)]">
        <Icon path={mdiMagnify} size={0.6} /> Search add-ons</div>
      <span className="rounded-lg border border-[var(--border-secondary)] px-2 py-1 text-xs text-[var(--text-secondary)]">Filter ▾</span>
    </div>
  );
}

function ProposedPage() {
  const head = (t: string) => <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{t}</div>;
  return (
    <div className="bg-[var(--bg-primary)] text-[var(--text-primary)] pb-2">
      <Fix n={1} tip="One sentence, one help link" block>
        <div className="px-4 pt-4">
          <h2 className="text-base font-semibold">Add-ons</h2>
          <p className="text-xs text-[var(--text-tertiary)]">What pi and this dashboard load. <a className="text-[var(--link)]">How add-ons work</a></p>
        </div>
      </Fix>
      <div className="flex gap-1 px-4 mt-3 text-sm border-b border-[var(--border-primary)]">
        <span className="px-2.5 py-2 border-b-2 border-[var(--accent)] font-medium">Installed (45)</span>
        <span className="px-2.5 py-2 text-[var(--text-tertiary)]">Updates (0)</span>
        <span className="px-2.5 py-2 text-[var(--text-tertiary)]">Discover</span>
        <span className="px-2.5 py-2 text-[var(--text-tertiary)]">Issues (1)</span>
      </div>
      <Fix n={3} tip="Search + one Filter menu" block><Toolbar /></Fix>
      <Fix n={4} tip="No empty groups, no legend" block>
        {head("Core")}
        <Fix n={2} tip="Local flag + fix live on the row" block><ProposedRow r={R[0]} /></Fix>
      </Fix>
      {head("Agent + dashboard")}
      <ProposedRow r={R[1]} /><ProposedRow r={R[2]} /><ProposedRow r={R[3]} ring /><ProposedRow r={R[4]} />
    </div>
  );
}

const mock: Mock = {
  title: "Add-ons page - declutter + show what a feature is made of",
  category: "Settings",
  frames: [
    { title: "Installed tab - desktop", width: 900,
      why: "Rows show name, one status, switch. Parts and details open on click.",
      current: <CurrentPage />, proposed: <ProposedPage /> },
    { title: "Installed tab - phone", phone: true, why: "Same rows fit 375px with no wrapping.",
      proposed: <ProposedPage /> },
  ],
};
export default mock;
