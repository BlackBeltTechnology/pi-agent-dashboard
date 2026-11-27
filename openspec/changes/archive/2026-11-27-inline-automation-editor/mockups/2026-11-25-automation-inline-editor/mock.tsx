// Automation board: edit IN the board instead of a stacked modal.
// Current = the REAL AutomationBoard (fixtures below) with a script that clicks Edit / + Create,
// which opens today's CreateAutomationDialog (fixed inset-0 modal, max-w-lg) over the overlay page.
// Proposed = two layout variants composed from the REAL plugin pieces: automation-card-visuals
// (rail/dot/pill/buttons) and the runtime field family (TextField / SelectField / TextAreaField /
// NumberField, with the per-field "Changed" pill) instead of the dialog's undefined `input` class.
//   A = expand in place (the card becomes the editor; one open at a time).
//   B = list + detail (selection drives a right-hand pane holding editor + run history).
// Every dialog feature is mapped (see FEATURE MAP at the bottom of this file).
// Change: inline-automation-editor (variant A accepted).
import { AutomationBoard } from "@automation/client/AutomationBoard.tsx";
import {
  cardButtonClass,
  deriveCardState,
  dotClass,
  headlessSourceIcon,
  pillClass,
  pillLabel,
  railBgClass,
  runPillClass,
  stripeFxClass,
} from "@automation/client/automation-card-visuals.ts";
import type {
  ActionDescriptor,
  AutomationConfig,
  DiscoveredAutomation,
  RunRecord,
  TriggerCategoryDescriptor,
} from "@automation/shared/automation-types.ts";
import { createHostPrimitiveRegistry } from "@app/lib/plugins/host-primitives.tsx";
import {
  NumberField,
  SelectField,
  SettingsNotice,
  TextAreaField,
  TextField,
  UiPrimitiveProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { mdiCalendarClock, mdiClipboardTextOutline, mdiFlashOutline, mdiSourceBranch } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fix, Issue, type Fixtures, type Mock, Tap } from "mock-site/kit";
import { createContext, type ReactNode, useContext, useState } from "react";

// ── Real data (shapes from automation-types.ts; values from the reported screenshot) ──
const CWD = "/Users/bmiller/Projects/invoice-bot-project/invoice-bot-dashboard";
const CLOCK = "2026-11-25T15:46:00"; // → "next run in 18h 14m" for 0 10 * * *, as in the screenshot
const T0 = new Date(CLOCK).getTime();
const H = 3_600_000;

const PROMPT = `<!-- daily-continuity:run -->
# Daily continuity run

Read yesterday's session notes in .pi/continuity/ and the git log since the last run.
Write a short handoff to .pi/continuity/today.md:
- what shipped, what is half-done, what is blocked
- the first command to run this morning`;

const CFG: Record<string, AutomationConfig> = {
  "daily-continuity": {
    on: { kind: "schedule", cron: "0 10 * * *" },
    action: { kind: "core.prompt", prompt: "./prompt.md" },
    model: "@fast",
    mode: "local",
    sandbox: "workspace-write",
    concurrency: "skip",
  },
  "nightly-deps-audit": {
    on: { kind: "schedule", cron: "0 2 * * *" },
    action: { kind: "core.skill", skill: "$deps-audit" },
    model: "anthropic/claude-sonnet-4-5",
    mode: "worktree",
    sandbox: "read-only",
    concurrency: "skip",
  },
  "pr-triage": {
    on: { kind: "schedule", cron: "*/30 * * * *" },
    action: { kind: "flows.run", payload: { flow: "custom:pr-triage" } },
    model: "@fast",
    mode: "local",
    sandbox: "read-only",
    concurrency: "queue",
  },
};

const AUTOMATIONS: DiscoveredAutomation[] = [
  { name: "daily-continuity", scope: "folder", dir: `${CWD}/.pi/automation/daily-continuity`, config: CFG["daily-continuity"], valid: true },
  { name: "nightly-deps-audit", scope: "folder", dir: `${CWD}/.pi/automation/nightly-deps-audit`, config: CFG["nightly-deps-audit"], valid: true },
  { name: "pr-triage", scope: "global", dir: "/Users/bmiller/.pi/automation/pr-triage", config: CFG["pr-triage"], valid: true },
];

const RUNS: RunRecord[] = [
  { runId: "2026-11-25-1000-daily-continuity", name: "daily-continuity", status: "done", dir: "", startedAt: T0 - 5.8 * H, endedAt: T0 - 5.75 * H, findings: 4, scope: "folder" },
  { runId: "2026-11-24-1000-daily-continuity", name: "daily-continuity", status: "done", dir: "", startedAt: T0 - 29.8 * H, endedAt: T0 - 29.7 * H, findings: 2, scope: "folder" },
  { runId: "2026-11-25-0200-nightly-deps-audit", name: "nightly-deps-audit", status: "error", dir: "", startedAt: T0 - 13.8 * H, endedAt: T0 - 13.7 * H, error: "npm audit exited 1", scope: "folder" },
  { runId: "2026-11-25-1530-pr-triage", name: "pr-triage", status: "running", dir: "", startedAt: T0 - 0.27 * H, scope: "global", sessionId: "s-pr-triage" },
];

const CATEGORIES: TriggerCategoryDescriptor[] = [
  { category: "scheduled", label: "Scheduled", status: "enabled", events: [] },
  { category: "openspec", label: "OpenSpec", status: "planned", events: [] },
  { category: "git", label: "Git", status: "planned", events: [] },
  { category: "file", label: "File", status: "planned", events: [] },
  { category: "webhook", label: "Webhook", status: "planned", events: [] },
];

const ACTIONS: ActionDescriptor[] = [
  { id: "core.prompt", source: "core", label: "Prompt", description: "Seed a fresh session with a durable prompt", available: true, payloadSchema: [] },
  { id: "core.skill", source: "core", label: "Skill", description: "Invoke a $skill in a fresh session", available: true, payloadSchema: [] },
  { id: "flows.run", source: "flows", label: "Run flow", description: "Run a registered pi flow", available: true, payloadSchema: [{ key: "flow", label: "Flow", type: "enum", options: ["custom:pr-triage", "custom:update-dashboard"] }] },
];

const BASE = "/api/plugins/automation";
const fixtures = (): Fixtures => ({
  http: {
    [`GET ${BASE}/list`]: () => ({ automations: AUTOMATIONS }),
    [`GET ${BASE}/runs`]: (r) => {
      const scope = r.url.searchParams.get("scope");
      return { runs: RUNS.filter((x) => x.scope === scope) };
    },
    [`GET ${BASE}/definition`]: (r) => {
      const name = r.url.searchParams.get("name") ?? "";
      return { config: CFG[name], ...(name === "daily-continuity" ? { promptBody: PROMPT } : {}) };
    },
    [`GET ${BASE}/trigger-kinds`]: () => ({ categories: CATEGORIES }),
    [`GET ${BASE}/actions`]: () => ({ actions: ACTIONS }),
    [`GET ${BASE}/git-capable`]: () => ({ gitCapable: true }),
    "GET /api/roles": () => ({ roles: { fast: "anthropic/claude-haiku-4-5", default: "anthropic/claude-sonnet-4-5" } }),
    "GET /api/acp/agents": () => ({ agents: [] }),
  },
});

// ── Current: the real board inside the host providers ──
const primitives = createHostPrimitiveRegistry();
const slots = createSlotRegistry();
function Host({ children }: { children: ReactNode }) {
  return (
    <UiPrimitiveProvider value={primitives}>
      <PluginContextProvider registry={slots}>{children}</PluginContextProvider>
    </UiPrimitiveProvider>
  );
}
const RealBoard = ({ ring }: { ring: string }) => (
  <Host>
    <Issue n={ring} tip="Modal stacked on an overlay page" block>
      <div className="flex h-[860px] flex-col bg-[var(--bg-primary)]">
        <AutomationBoard cwd={CWD} params={{ encodedCwd: "x" }} onBack={() => {}} />
      </div>
    </Issue>
  </Host>
);

// ── Proposed building blocks ──
// Rings render once per pane; a later flow step turns the shared ones off (ring ids stay unique).
const RingsOn = createContext(true);
function F({ n, tip, children }: { n: string; tip: string; children: ReactNode }) {
  // \`block\` rings are grid boxes: min-w-0 stops a long caption from widening the card on a phone.
  return useContext(RingsOn) ? <Fix n={n} tip={tip} block><div className="min-w-0">{children}</div></Fix> : <>{children}</>;
}
type Layout = "A" | "B";
const SECTION_H = "text-[12px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]";

function BoardHeader({ editing }: { editing?: boolean }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" className="text-xs text-[var(--text-secondary)]">← Back</button>
        <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">Automations</h2>
        <span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">invoice-bot-dashboard</span>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={editing} className={cardButtonClass("primary")}>+ Create Automation</button>
        <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]"><input type="checkbox" /> Show archived</label>
      </div>
    </div>
  );
}

function TriggerPills() {
  const icons: Record<string, string> = { scheduled: mdiCalendarClock, openspec: mdiClipboardTextOutline, git: mdiSourceBranch, file: mdiFlashOutline, webhook: mdiFlashOutline };
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Trigger">
      {CATEGORIES.map((c) => {
        const on = c.category === "scheduled";
        const planned = c.status === "planned";
        return (
          <button
            key={c.category}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={planned}
            className={`focus-ring items-center gap-1 rounded-full border px-2.5 min-h-[32px] max-sm:min-h-[44px] text-[13px] ${planned ? "hidden sm:inline-flex" : "inline-flex"} ${
              on
                ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]"
                : "border-[var(--border-secondary)] text-[var(--text-secondary)] disabled:opacity-60"
            }`}
          >
            <Icon path={icons[c.category] ?? mdiFlashOutline} size={0.55} aria-hidden="true" />
            {c.label}
            {planned ? <span className="text-[11px]">soon</span> : null}
          </button>
        );
      })}
      <span className="sm:hidden">
        <F n="soon" tip="Phone: planned triggers fold into one">
          <span className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-[var(--border-secondary)] px-2.5 text-[12px] text-[var(--text-secondary)]">
            +4 coming soon
          </span>
        </F>
      </span>
    </div>
  );
}

function TriggerSection({ dirty, focus }: { dirty?: boolean; focus?: boolean }) {
  const [freq, setFreq] = useState("daily");
  const [time, setTime] = useState(dirty ? "09:30" : "10:00");
  return (
    <section aria-labelledby="sec-trigger" className={`space-y-2 ${focus ? "rounded-lg outline outline-2 outline-offset-4 outline-[var(--accent)]" : ""}`}>
      <h4 id="sec-trigger" className={SECTION_H}>Trigger</h4>
      <TriggerPills />
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
        <SelectField label="Frequency" hint={null} value={freq} onChange={setFreq} options={[{ value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" }, { value: "weekdays", label: "Weekdays" }, { value: "weekly", label: "Weekly" }]} />
        <TextField label="Time" hint={null} type="time" value={time} onChange={setTime} state={dirty ? "changed" : undefined} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--status-ok,var(--tint-green-fg))]" aria-hidden="true" />Next run: {dirty ? "tomorrow 09:30 (in 17h 44m)" : "tomorrow 10:00 (in 18h 14m)"}</span>
        <code className="font-mono">{dirty ? "30 9 * * *" : "0 10 * * *"}</code>
        <button type="button" className="focus-ring rounded underline">edit raw cron</button>
      </p>
    </section>
  );
}

function ActionSection({ dirty, wide }: { dirty?: boolean; wide: boolean }) {
  const [prompt, setPrompt] = useState(dirty ? `${PROMPT}\n- open PRs waiting on me` : PROMPT);
  const [count, setCount] = useState(1);
  return (
    <section aria-labelledby="sec-action" className="min-w-0 space-y-2">
      <h4 id="sec-action" className={SECTION_H}>Action</h4>
      <F n="picker" tip="Full action names, no truncation">
        <div role="radiogroup" aria-label="Action" className={`grid gap-1 ${wide ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1"}`}>
          {ACTIONS.map((a) => {
            const on = a.id === "core.prompt";
            return (
              <button key={a.id} type="button" role="radio" aria-checked={on}
                className={`focus-ring flex flex-col items-start rounded-md border px-2 py-1.5 text-left ${on ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border-secondary)] hover:bg-[var(--bg-hover)]"}`}>
                <code className="font-mono text-[12px] text-[var(--text-primary)]">{a.id}</code>
                <span className="text-[12px] text-[var(--text-secondary)]">{a.description}</span>
              </button>
            );
          })}
        </div>
      </F>
      <F n="prompt" tip="Prompt editor uses the full width">
        <TextAreaField label="Prompt" keyLabel="prompt.md" hint="Saved next to automation.yaml; edits apply from the next run." value={prompt} onChange={setPrompt} rows={wide ? 9 : 7} mono state={dirty ? "changed" : undefined} />
      </F>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <NumberField label="Sessions per run" hint={null} value={count} onChange={setCount} />
        <button type="button" className="focus-ring rounded text-[13px] font-semibold text-[var(--accent-text)] underline">+ Add action</button>
      </div>
    </section>
  );
}

function ModelSection() {
  const [agent, setAgent] = useState("");
  return (
    <section aria-labelledby="sec-model" className="space-y-2">
      <h4 id="sec-model" className={SECTION_H}>Runs as</h4>
      <SelectField label="Agent" hint={null} value={agent} onChange={setAgent} options={[{ value: "", label: "pi (default)" }, { value: "claude-code", label: "claude-code (ACP)" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">Model</span>
        <button type="button" className="focus-ring inline-flex items-center gap-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)]">@fast <span className="text-[var(--text-secondary)]">▾</span></button>
      </div>
    </section>
  );
}

function AdvancedSection() {
  return (
    <details className="group rounded-lg border border-[var(--border-secondary)] px-3 py-2">
      <summary className="focus-ring cursor-pointer rounded text-[13px] font-semibold text-[var(--text-secondary)]">Advanced <span className="font-normal">· local · skip · workspace-write</span></summary>
      <div className="mt-2 space-y-2">
        <SelectField label="Mode" hint={null} value="local" onChange={() => {}} options={[{ value: "local", label: "local" }, { value: "worktree", label: "worktree" }]} />
        <SelectField label="Concurrency" hint={null} value="skip" onChange={() => {}} options={[{ value: "skip", label: "skip" }, { value: "queue", label: "queue" }, { value: "parallel", label: "parallel" }]} />
        <SelectField label="Sandbox" hint={null} value="workspace-write" onChange={() => {}} options={[{ value: "read-only", label: "read-only" }, { value: "workspace-write", label: "workspace-write" }, { value: "full-access", label: "full-access" }]} />
      </div>
    </details>
  );
}

function IdentitySection() {
  const [name, setName] = useState("weekly-invoice-recon");
  const [scope, setScope] = useState("folder");
  return (
    <section aria-labelledby="sec-id" className="grid gap-2 sm:grid-cols-2">
      <h4 id="sec-id" className={`${SECTION_H} sm:col-span-2`}>New automation</h4>
      <TextField label="Name" hint="Folder name under .pi/automation/. Fixed after create." value={name} onChange={setName} mono />
      <SelectField label="Scope" hint={null} value={scope} onChange={setScope} options={[{ value: "folder", label: "folder (this repo)" }, { value: "global", label: "global (~/.pi/automation)" }]} />
    </section>
  );
}

/** Sticky save bar: replaces the dialog footer + "armed on save" chip. */
function SaveBar({ name, dirty, create, guard }: { name: string; dirty: number; create?: boolean; guard?: string }) {
  return (
    <F n="savebar" tip="Sticky save bar replaces dialog footer">
      <div className="sticky bottom-0 z-[1] -mx-3 -mb-3 mt-1 flex flex-col gap-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2">
        {guard ? (
          <Fix n="guard" tip="Inline guard, edits are never lost" block>
            <SettingsNotice tone="warning" role="alert">
              {dirty} unsaved change{dirty === 1 ? "" : "s"} in <b>{name}</b>. Save or discard before editing <b>{guard}</b>.
            </SettingsNotice>
          </Fix>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-full min-w-0 truncate font-mono text-[11px] text-[var(--text-secondary)] sm:mr-auto sm:w-auto">
            Writes .pi/automation/{name}/automation.yaml + prompt.md
          </span>
          {dirty > 0 ? <span className="mr-auto text-[12px] text-[var(--text-secondary)] sm:mr-0" aria-live="polite">{dirty} unsaved change{dirty === 1 ? "" : "s"}</span> : null}
          {create ? <span className="text-[12px] text-[var(--text-secondary)]">Arms on create · next run in 18h 14m</span> : null}
          <button type="button" className={cardButtonClass()}>{guard ? "Discard" : "Cancel"}</button>
          <button type="button" disabled={!create && dirty === 0} className={cardButtonClass("primary")}>{create ? "Create" : guard ? "Save & switch" : "Save"}</button>
        </div>
      </div>
    </F>
  );
}

function EditorBody({ wide, dirty, create, focusTrigger }: { wide: boolean; dirty?: boolean; create?: boolean; focusTrigger?: boolean }) {
  return (
    <div className={`grid min-w-0 gap-4 ${wide ? "grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]" : "grid-cols-[minmax(0,1fr)]"}`}>
      {create ? <div className={wide ? "lg:col-span-2" : ""}><IdentitySection /></div> : null}
      <div className="min-w-0 space-y-4">
        <TriggerSection dirty={dirty} focus={focusTrigger} />
        <ModelSection />
        <AdvancedSection />
      </div>
      <ActionSection dirty={dirty} wide={wide} />
    </div>
  );
}

function CardHead({ a, selected, editing, compact }: { a: DiscoveredAutomation; selected?: boolean; editing?: boolean; compact?: boolean }) {
  const running = RUNS.some((r) => r.name === a.name && r.status === "running");
  const state = deriveCardState({ valid: a.valid, disabled: !!a.config?.disabled, running });
  const stripe = stripeFxClass(state);
  return (
    <div className={`flex flex-wrap items-center gap-2 ${selected ? "-mx-3 -mt-3 px-3 pt-3 pb-1.5 bg-[var(--accent-soft)]" : ""}`}>
      <Icon path={headlessSourceIcon} size={0.5} className="text-[var(--text-secondary)]" />
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass(state)}`} />
      <span className={`max-w-full truncate font-mono text-[13px] text-[var(--text-primary)] ${selected ? "font-bold" : "font-semibold"}`}>{a.name}</span>
      <span className="rounded bg-[var(--bg-surface)] px-1 text-[11px] text-[var(--text-secondary)]">{a.scope}</span>
      <span className={pillClass(state)}>{stripe ? <span className={stripe} aria-hidden="true" /> : null}{pillLabel(state)}</span>
      {compact ? null : (
        <>
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2">
            {running ? <button type="button" className={cardButtonClass("danger")}>⏹ Stop</button> : (
              <>
                <button type="button" className={`${cardButtonClass()} ${editing ? "max-sm:hidden" : ""}`}>▶ Run now</button>
                <button type="button" className={`${cardButtonClass()} ${editing ? "max-sm:hidden" : ""}`}>Disable</button>
              </>
            )}
            {editing ? (
              <F n="close" tip="Edit toggles to Close editor">
                <button type="button" aria-expanded="true" className={cardButtonClass()}>Close editor</button>
              </F>
            ) : <button type="button" aria-expanded="false" className={cardButtonClass()}>Edit</button>}
            <button type="button" aria-label="More actions" className={cardButtonClass()}>⋯</button>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ a }: { a: DiscoveredAutomation }) {
  const c = a.config;
  const label = c?.on.cron === "0 10 * * *" ? "Daily at 10:00" : c?.on.cron === "0 2 * * *" ? "Daily at 02:00" : "Every 30 min";
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
      <span className="font-semibold text-[var(--text-primary)]">{label}</span>
      <span>{c?.action?.kind}</span>
      <span>{c?.model}</span>
      <span>mode: {c?.mode}</span>
    </div>
  );
}

function LastRun({ name }: { name: string }) {
  const r = RUNS.find((x) => x.name === name);
  if (!r) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)]">
      <span className={runPillClass(r.status)}>{r.status}</span>
      <span className="text-[var(--text-primary)]">{r.status === "running" ? "started 16m ago" : name === "daily-continuity" ? "today 10:00" : "today 02:00"}</span>
      {r.findings ? <span>{r.findings} findings</span> : null}
      <span className="flex-1" />
      <button type="button" className="font-semibold text-[var(--accent-text)] underline">{r.status === "running" ? "Watch" : r.status === "error" ? "Log" : "Result"}</button>
    </div>
  );
}

function Card({ a, editing, dirty, guard, children }: { a: DiscoveredAutomation; editing?: boolean; dirty?: boolean; guard?: string; children?: ReactNode }) {
  const running = RUNS.some((r) => r.name === a.name && r.status === "running");
  const state = deriveCardState({ valid: a.valid, disabled: false, running });
  const stripe = stripeFxClass(state);
  return (
    <li aria-current={editing ? "true" : undefined}
      className={`relative isolate flex rounded-xl border bg-[var(--bg-secondary)] ${editing ? "border-[var(--accent)]" : "border-[var(--border-secondary)] overflow-hidden"}`}>
      <div className={`relative isolate w-1 self-stretch overflow-hidden rounded-l-xl ${railBgClass(state)}`} aria-hidden="true">{stripe ? <div className={stripe} /> : null}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <CardHead a={a} selected={editing} editing={editing} />
        <Summary a={a} />
        {editing ? (
          <div className="min-w-0"><F n="inline" tip="Editor opens inside the card">
            <div className="mt-1 border-t border-[var(--border-secondary)] pt-3">
              <EditorBody wide dirty={dirty} />
              <div className="h-3" />
              <SaveBar name={a.name} dirty={dirty ? 2 : 0} guard={guard} />
            </div>
          </F></div>
        ) : <LastRun name={a.name} />}
        {children}
      </div>
    </li>
  );
}

const byName = (n: string) => AUTOMATIONS.find((a) => a.name === n) as DiscoveredAutomation;

// ── Variant A: expand in place ──
function BoardA({ dirty, guard, create, phone }: { dirty?: boolean; guard?: boolean; create?: boolean; phone?: boolean }) {
  return (
    <div className="flex min-h-[860px] flex-col bg-[var(--bg-primary)] text-sm">
      <BoardHeader editing={create} />
      <div className="flex flex-col gap-3 p-3">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Definitions</h3>
        <ul className="space-y-2">
          {create ? (
            <F n="draft" tip="Create = draft card at top of list">
              <li className="flex rounded-xl border border-dashed border-[var(--accent)] bg-[var(--bg-secondary)]">
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
                  <EditorBody wide={!phone} create />
                  <SaveBar name="weekly-invoice-recon" dirty={0} create />
                </div>
              </li>
            </F>
          ) : null}
          {AUTOMATIONS.map((a) =>
            a.name === "daily-continuity" && !create ? (
              phone ? <PhoneCard key={a.name} a={a} /> : <Card key={a.name} a={a} editing dirty={dirty} guard={guard ? "pr-triage" : undefined} />
            ) : a.name === "pr-triage" && guard ? (
              <Tap key={a.name}><Card a={a} /></Tap>
            ) : <Card key={a.name} a={a} />,
          )}
        </ul>
      </div>
    </div>
  );
}

function PhoneCard({ a }: { a: DiscoveredAutomation }) {
  return (
    <li aria-current="true" className="flex rounded-xl border border-[var(--accent)] bg-[var(--bg-secondary)]">
      <div className={`w-1 self-stretch rounded-l-xl ${railBgClass("enabled")}`} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <CardHead a={a} selected editing />
        <div className="min-w-0">
          <F n="phone" tip="Single column; save bar stays reachable">
            <div className="border-t border-[var(--border-secondary)] pt-3">
              <EditorBody wide dirty />
              <div className="h-3" />
              <SaveBar name={a.name} dirty={2} />
            </div>
          </F>
        </div>
      </div>
    </li>
  );
}

// ── Variant B: list + detail ──
function BoardB({ create, dirty }: { create?: boolean; dirty?: boolean }) {
  const sel = byName("daily-continuity");
  return (
    <div className="flex h-[860px] flex-col bg-[var(--bg-primary)] text-sm">
      <BoardHeader editing={create} />
      <F n="split" tip="List left, editor + runs right">
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
          <ul className="space-y-2 overflow-y-auto border-r border-[var(--border-primary)] p-3" aria-label="Automations">
            {create ? (
              <li className="rounded-xl border border-dashed border-[var(--accent)] bg-[var(--accent-soft)] p-3 font-mono text-[13px] font-bold text-[var(--text-primary)]" aria-current="true">new automation</li>
            ) : null}
            {AUTOMATIONS.map((a) => {
              const on = !create && a.name === sel.name;
              return (
                <li key={a.name} aria-current={on ? "true" : undefined}
                  className={`flex flex-col gap-1 overflow-hidden rounded-xl border bg-[var(--bg-secondary)] p-3 ${on ? "border-[var(--accent)]" : "border-[var(--border-secondary)]"}`}>
                  <CardHead a={a} selected={on} compact />
                  <Summary a={a} />
                  <LastRun name={a.name} />
                </li>
              );
            })}
          </ul>
          <div className="flex min-h-0 flex-col overflow-y-auto">
            <div className="flex flex-col gap-3 p-3">
              {create ? (
                <>
                  <EditorBody wide={false} create />
                  <SaveBar name="weekly-invoice-recon" dirty={0} create />
                </>
              ) : (
                <>
                  <CardHead a={sel} />
                  <Summary a={sel} />
                  <EditorBody wide={false} dirty={dirty} />
                  <section aria-labelledby="sec-runs" className="space-y-1">
                    <h4 id="sec-runs" className={SECTION_H}>Runs (2)</h4>
                    <LastRun name={sel.name} />
                  </section>
                  <SaveBar name={sel.name} dirty={dirty ? 2 : 0} />
                </>
              )}
            </div>
          </div>
        </div>
      </F>
    </div>
  );
}

const editScript = [
  { say: "Click Edit on daily-continuity", target: "edit-daily-continuity", act: "click" as const },
  { say: "Today: a modal over the board", target: "create-automation-dialog", act: "wait" as const },
];
const createScript = [
  { say: "Click + Create Automation", target: "automation-create-btn", act: "click" as const },
  { say: "Today: the same modal, empty", target: "create-automation-dialog", act: "wait" as const },
];

const mock: Mock = {
  title: "Automation editor - inline in the board, no dialog",
  category: "Automations",
  change: "inline-automation-editor",
  fixtures,
  frames: [
    {
      title: "Edit - variant A, expand in place (desktop)",
      width: 1100,
      clockAt: CLOCK,
      why: "The board is already a full page; edit where you clicked, at full width, without stacking a modal.",
      current: <RealBoard ring="modal" />,
      proposed: <BoardA dirty />,
      script: editScript,
      side: "current",
    },
    {
      title: "Edit - variant B, list + detail (desktop)",
      width: 1100,
      clockAt: CLOCK,
      why: "Selection drives a detail pane: editor and run history sit together, list stays visible.",
      current: <RealBoard ring="modal" />,
      proposed: <BoardB dirty />,
      script: editScript,
      side: "current",
    },
    {
      title: "Create - variant A, draft card",
      width: 1100,
      clockAt: CLOCK,
      why: "+ Create inserts a draft card on top; Name and Scope are only editable here.",
      current: <RealBoard ring="modal" />,
      proposed: <BoardA create />,
      script: createScript,
      side: "current",
    },
    {
      title: "Create - variant B, draft in the detail pane",
      width: 1100,
      clockAt: CLOCK,
      why: "Draft row selected in the list; the detail pane is the create form.",
      current: <RealBoard ring="modal" />,
      proposed: <BoardB create />,
      script: createScript,
      side: "current",
    },
    {
      title: "Edit - phone",
      phone: true,
      clockAt: CLOCK,
      why: "One column, no sideways scroll; planned triggers fold, Run now/Disable move to the overflow menu while editing.",
      current: <RealBoard ring="modal" />,
      proposed: <BoardA phone />,
      script: editScript,
      side: "current",
    },
    {
      title: "Unsaved changes - switching cards (A)",
      width: 1100,
      why: "One editor at a time; leaving a dirty card asks inline instead of losing edits.",
      steps: [
        { label: "editing, 2 unsaved", proposed: <BoardA dirty guard={false} /> },
        { label: "clicked pr-triage", proposed: <RingsOn.Provider value={false}><BoardA dirty guard /></RingsOn.Provider> },
      ],
    },
  ],
};
export default mock;

/* FEATURE MAP (CreateAutomationDialog -> inline editor)
 * header title + subtitle (scope · path)  -> card header (name, scope badge) + save-bar caption
 * armed-chip "armed on save"              -> save bar "Arms on create · next run …" (create) / status pill (edit)
 * Identity: name (locked on edit), scope  -> create: IdentitySection; edit: read-only in header (no "locked" note)
 * Trigger: category pills (+ "soon"), freq/time/day helper, raw cron toggle, next-run preview,
 *          file trigger path + events + their validation  -> TriggerSection (unchanged logic)
 * Action: grouped searchable picker, prompt.md textarea, skill, payload form, AutomationActionEditorSlot,
 *         sessions per run, extra actions (+ Add action) -> ActionSection (wide column)
 * Agent select + model-by-agent hint, Model + level      -> "Runs as" section
 * Advanced (collapsed): mode (+git probe hint), concurrency, sandbox, visibility -> <details> with summary of values
 * error, footer caption, dirty count, Cancel / Save|Create -> SaveBar (sticky), per-field "Changed" pill
 * initialSection deep-links (name -> identity, summary -> trigger) -> expand card + scroll/focus that section
 * focus restore to opener                 -> focus returns to Edit / + Create on close
 * NEW: dirty guard when opening another card / leaving the board
 */
