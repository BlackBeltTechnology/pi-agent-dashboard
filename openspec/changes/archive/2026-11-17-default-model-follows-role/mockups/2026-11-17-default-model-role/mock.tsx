// Explore-mode live mock: Settings -> Sessions -> "Default model" may follow a model ROLE.
// Current = today's callout (SettingsPanel.tsx "New session defaults", exact parent classes)
// with the real ModelSelector + ThinkingLevelSelector. Proposed = same callout, ModelSelector
// gets `allowRoles` (already shipped for composer/spawn), the value persists as `@role`,
// and a follow hint names the active preset. Fixture roles/presets mirror the real
// ~/.pi/agent/providers.json shape served by GET /api/roles (roles-plugin roles-routes.ts).

import { RoleRef } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ModelSelector } from "@app/components/settings/ModelSelector.tsx";
import { ThinkingLevelSelector } from "@app/components/settings/ThinkingLevelSelector.tsx";
import { Fix, type Fixtures, Issue, type Mock } from "mock-site/kit";
import { type ReactNode, useEffect, useState } from "react";

// ---- fixture data (real shapes: ModelInfo + RoleGroup/RoleRow) ----
const LEVELS = ["off", "minimal", "low", "medium", "high"];
const m = (provider: string, id: string, name: string, extra: Partial<ModelInfo> = {}): ModelInfo =>
  ({ provider, id, name, reasoning: true, vision: true, contextWindow: 200_000, metadataSource: "catalog", supportedThinkingLevels: LEVELS, ...extra }) as ModelInfo;
const MODELS: ModelInfo[] = [
  m("anthropic", "claude-opus-5-5", "Claude Opus 5.5"),
  m("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
  m("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5"),
  m("proxy", "cc/claude-sonnet-5-5", "cc / Claude Sonnet 5.5"),
  m("proxy", "cc/claude-haiku-5-5", "cc / Claude Haiku 5.5"),
  m("local", "ocg/longcat-2.5-preview-free", "LongCat 2.5 preview (free)", { vision: false, contextWindow: 128_000 }),
];

type Assign = Record<string, string | null>; // role -> "provider/id[:level]" | null (unassigned)
const PRESETS: Record<string, Assign> = {
  Anthropic: { planning: "anthropic/claude-sonnet-5-5:high", coding: "anthropic/claude-haiku-5-5", fast: "anthropic/claude-haiku-5-5:off", review: "anthropic/claude-sonnet-5-5", validate: "anthropic/claude-opus-5-5" },
  Proxy: { planning: "proxy/cc/claude-sonnet-5-5:high", coding: "proxy/cc/claude-sonnet-5-5", fast: "proxy/cc/claude-haiku-5-5", review: "proxy/cc/claude-sonnet-5-5", validate: null },
  Free: { planning: "local/ocg/longcat-2.5-preview-free", coding: "local/ocg/longcat-2.5-preview-free", fast: "local/ocg/longcat-2.5-preview-free", review: null, validate: null },
};
const BUILTIN = new Set(["planning", "coding", "fast", "review"]);

function row(role: string, ref: string | null) {
  if (!ref) return { role, ref: null, assigned: false, builtin: BUILTIN.has(role) };
  const [model, level] = ref.split(":");
  const slash = model.indexOf("/");
  return { role, ref, assigned: true, builtin: BUILTIN.has(role), model, provider: model.slice(0, slash), ...(level ? { thinkingLevel: level } : {}) };
}
function rolesBody(active: string) {
  const group = (preset: string | null, name: string) => ({ preset, active: preset === null, roles: Object.entries(PRESETS[name]).map(([r, ref]) => row(r, ref)) });
  return { object: "list", data: [group(null, active), ...Object.keys(PRESETS).map((p) => ({ ...group(p, p), active: p === active }))] };
}
/** Fresh per pane + loop. `POST /api/roles/preset` stands in for the Roles page preset Load. */
const rolesFixtures = (start: string) => (): Fixtures => {
  let active = start;
  return {
    http: {
      "GET /api/roles": () => rolesBody(active),
      "POST /api/roles/preset": (r) => { active = r.json<{ name: string }>().name; return { ok: true }; },
    },
  };
};

// ---- live role resolution (what the real callout would read for the follow hint) ----
type Live = { preset: string; rows: ReturnType<typeof row>[] };
function useLiveRoles(tick: number): Live | null {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    void fetch("/api/roles").then((r) => r.json()).then((b: ReturnType<typeof rolesBody>) => {
      const activeGroup = b.data.find((g) => g.preset !== null && g.active);
      setLive({ preset: activeGroup?.preset ?? "", rows: b.data[0].roles as ReturnType<typeof row>[] });
    });
  }, [tick]);
  return live;
}

// ---- page parts: exact parent markup from SettingsPanel "New session defaults" ----
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
const HINT = "Applied only to brand-new sessions. A resumed session keeps the model it was started with. Leave empty to use pi's own default.";
const Callout = ({ children }: { children: ReactNode }) => (
  <div className="rounded border px-3 py-2.5 bg-[var(--severity-info-bg)] border-[var(--severity-info-border)]">{children}</div>
);
const Label = () => <label className="text-sm font-medium text-[var(--severity-info-fg)]">Default model</label>;

function CurrentCallout() {
  const [model, setModel] = useState("anthropic/claude-sonnet-5-5");
  const [level, setLevel] = useState("medium");
  return (
    <Section title="New session defaults">
      <Callout>
        <div className="flex items-center justify-between">
          <Label />
          <div className="flex items-center gap-2">
            <Issue n={1} tip="Concrete model only, no roles">
              <ModelSelector current={model} models={MODELS} onSelect={setModel} />
            </Issue>
            <Issue n={2} tip="Level set by hand, never from a role">
              <ThinkingLevelSelector current={level} supportedLevels={LEVELS} onSelect={setLevel} />
            </Issue>
          </div>
        </div>
        <Issue n={3} tip="Preset switch leaves this stale" block>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">{HINT}</p>
        </Issue>
      </Callout>
    </Section>
  );
}

function Ring({ on, n, tip, block, children }: { on: boolean; n: number; tip: string; block?: boolean; children: ReactNode }) {
  return on ? <Fix n={n} tip={tip} block={block}>{children}</Fix> : <>{children}</>;
}

/**
 * Proposed: `allowRoles` on the default-model picker. Value persists as `@role`; a role pick
 * also saves `defaultThinkingLevel: ""`. The level selector shows the role's level (tag `role`)
 * while `defaultThinkingLevel` is empty; a pick writes `defaultThinkingLevel` (design D2).
 * A follow hint names the active preset and what the role resolves to.
 */
function ProposedCallout({ initial, tick = 0, ringed = true }: { initial: string; tick?: number; ringed?: boolean }) {
  const [value, setValue] = useState(initial);
  const [override, setOverride] = useState(""); // config.defaultThinkingLevel
  const live = useLiveRoles(tick);
  const ref = /^@([^:]+)(?::(.+))?$/.exec(value);
  const r = ref ? live?.rows.find((x) => x.role === ref[1]) : undefined;
  const roleLevel = r && "thinkingLevel" in r ? r.thinkingLevel : undefined;
  const level = override || (ref ? ref[2] ?? roleLevel : "medium");

  const hint = !ref ? null : !live ? null : r && "model" in r ? (
    <p className="mt-1 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-1" data-testid="default-model-follows">
      <span>Follows</span> <RoleRef role={`@${ref[1]}`} model={r.model} />
      <span>in preset <span className="font-medium text-[var(--text-primary)]">{live.preset}</span>. Switching preset changes the model for the next new session.</span>
    </p>
  ) : (
    <p className="mt-1 text-xs text-[var(--severity-warning-fg)] flex flex-wrap items-center gap-1" data-testid="default-model-dangling">
      <RoleRef role={`@${ref[1]}`} />
      <span>has no model in preset <span className="font-medium">{live.preset}</span>. New sessions use pi's own default model until it is assigned.</span>
    </p>
  );

  return (
    <Section title="New session defaults">
      <Callout>
        <div className="flex items-center justify-between">
          <Label />
          <div className="flex items-center gap-2">
            <Ring on={ringed} n={1} tip="Models | Roles tabs, persists @role">
              <ModelSelector key={tick} current={value} models={MODELS} onSelect={(v) => { setValue(v); if (v.startsWith("@")) setOverride(""); }} allowRoles />
            </Ring>
            <Ring on={ringed} n={2} tip="Role level until overridden">
              <ThinkingLevelSelector
                current={level}
                placeholder="role"
                tag={ref && !override ? "role" : undefined}
                supportedLevels={LEVELS}
                onSelect={setOverride}
              />
            </Ring>
          </div>
        </div>
        <Ring on={ringed} n={3} tip="Names preset + resolved model" block>
          <div>
            {hint}
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">{HINT}</p>
          </div>
        </Ring>
      </Callout>
    </Section>
  );
}

// ---- scripted preset switch: a stand-in for Settings -> Roles "Load preset" ----
function PresetSwitchStage() {
  const [tick, setTick] = useState(0);
  const load = async (name: string) => {
    await fetch("/api/roles/preset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    setTick((t) => t + 1);
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-dashed border-[var(--border-primary)] px-3 py-2 text-xs text-[var(--text-tertiary)] flex items-center gap-2">
        <span>Elsewhere: Settings → Roles → Load preset</span>
        {Object.keys(PRESETS).map((p) => (
          <button key={p} type="button" data-testid={`load-${p}`} onClick={() => void load(p)}
            className="px-2 py-0.5 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">{p}</button>
        ))}
      </div>
      <ProposedCallout initial="@planning" tick={tick} ringed={false} />
    </div>
  );
}

const PAGE = "max-w-[640px] p-4 bg-[var(--bg-primary)]";

const mock: Mock = {
  title: "Settings default model - follow a role",
  category: "Settings",
  frames: [
    {
      title: "Sessions settings - default model follows @planning",
      width: 680,
      why: "Default model can be a role ref; it re-resolves when the active preset changes.",
      fixtures: rolesFixtures("Anthropic"),
      current: <div className={PAGE}><CurrentCallout /></div>,
      proposed: <div className={PAGE}><ProposedCallout initial="@planning" /></div>,
    },
    {
      title: "Picker - pick a role from the Roles tab",
      width: 680,
      why: "Same picker as composer/spawn: Models | Roles tabs. Picking a role persists @role, not its model.",
      fixtures: rolesFixtures("Anthropic"),
      proposed: <div className={`${PAGE} min-h-[440px]`}><ProposedCallout initial="anthropic/claude-sonnet-5-5" ringed={false} /></div>,
      script: [
        { say: "Open the default-model picker", target: "model-selector-button", act: "click" },
        { say: "Switch to the Roles tab", target: "model-tab-role", act: "click" },
        { say: "Pick @coding", target: "[data-role='coding']", act: "click" },
        { say: "Trigger now shows @coding -> model", act: "wait", target: "model-trigger-role-ref", expect: "default-model-follows" },
      ],
    },
    {
      title: "Preset switch - default model follows",
      width: 680,
      why: "Loading another preset updates the resolved default with no edit on this page.",
      fixtures: rolesFixtures("Anthropic"),
      proposed: <div className={PAGE}><PresetSwitchStage /></div>,
      script: [
        { say: "Anthropic: @planning -> claude-sonnet-5-5", act: "wait", target: "default-model-follows" },
        { say: "Load the Proxy preset", target: "load-Proxy", act: "click",
          expect: (d) => d.querySelector("[data-testid='default-model-follows']")?.textContent?.includes("Proxy") ?? false },
        { say: "Load the Free preset", target: "load-Free", act: "click",
          expect: (d) => d.querySelector("[data-testid='default-model-follows']")?.textContent?.includes("Free") ?? false },
        { say: "Back to Anthropic", target: "load-Anthropic", act: "click" },
      ],
    },
    {
      title: "Dangling - role unassigned in the active preset",
      width: 680,
      why: "@validate has no model in Free: say so and name the fallback instead of failing the spawn.",
      fixtures: rolesFixtures("Free"),
      proposed: <div className={PAGE}><ProposedCallout initial="@validate" ringed={false} /></div>,
    },
  ],
};
export default mock;
