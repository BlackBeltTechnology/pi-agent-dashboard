/**
 * cost-estimator · CLIENT entry.
 *
 * Renders measured delivery telemetry: active steering hours per project, the
 * meter-equivalent spend, and — when a seat plan is configured — the ACTUAL
 * subscription cost plus the leverage between the two.
 *
 * DISPLAY INVARIANT: the meter figure is labelled "meter-equivalent" wherever it
 * appears, and leverage is labelled leverage, never a saving. Presenting the
 * theoretical meter as cash out is the single easiest way to make an estimate
 * indefensible under scrutiny.
 */

import {
  NumberField,
  SelectField,
  useSettingsDraftSource,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Measured {
  sessions: number;
  activeHours: number;
  steeringDays: number;
  totalCost: number;
  costPerSteeringHour: number;
  costPerSteeringDay: number;
  contextFactor: number;
  revisionFactorLowerBound: number;
  outputShare: number;
  cacheReadShare: number;
  assistantPerHumanTurn: number;
  activeMonths: number;
  hoursPerMonth: number;
  meterPerMonth: number;
  unmeteredHourShare: number;
}

interface ProjectRow {
  project: string;
  sessions: number;
  activeHours: number;
  steeringDays: number;
  cost: number;
  costPerHour: number;
}

interface Subscription {
  monthlySeatCost: number;
  months: number;
  subscriptionCost: number;
  meterEquivalent: number;
  leverage: number;
  effectiveCostPerHour: number;
  meteredCostPerHour: number;
}

interface TelemetryPayload {
  ok: boolean;
  empty?: boolean;
  error?: string;
  measured: Measured | null;
  projects: ProjectRow[];
  subscription: Subscription | null;
  seatPlan?: string;
  seats?: number;
}

export interface CostEstimatorConfig {
  gapCapMinutes: number;
  hoursPerDay: number;
  seatPlan: string;
  seatMonthlyUsd: number;
  seats: number;
}

const num = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const cell: React.CSSProperties = { padding: "4px 10px", textAlign: "right", whiteSpace: "nowrap" };
const label: React.CSSProperties = { ...cell, textAlign: "left" };
const muted: React.CSSProperties = { fontSize: "11px", opacity: 0.65 };

/** CostView — full-screen measured-cost view. Claimed on content-view + command-route. */
export function CostView() {
  const [data, setData] = useState<TelemetryPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cost-estimator/telemetry")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<TelemetryPayload>;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <div style={{ padding: 16 }}>Could not load cost telemetry: {failed}</div>;
  if (!data) return <div style={{ padding: 16 }}>Measuring sessions…</div>;
  if (!data.ok) return <div style={{ padding: 16 }}>Cost telemetry unavailable: {data.error}</div>;
  if (data.empty || !data.measured) return <div style={{ padding: 16 }}>No sessions measured yet.</div>;

  const m = data.measured;
  const sub = data.subscription;

  return (
    <div data-testid="cost-view" style={{ padding: 16, overflow: "auto", fontSize: 13 }}>
      <h2 style={{ margin: "0 0 4px" }}>Measured delivery cost</h2>
      <div style={muted}>
        {num(m.sessions)} sessions · {num(m.activeHours, 1)} active steering hours ({num(m.steeringDays, 1)} steering-days)
        · {m.activeMonths} active months · breaks over the configured gap are excluded
      </div>

      {sub ? (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 4px" }}>Actual cost — subscription</h3>
          <table>
            <tbody>
              <tr>
                <td style={label}>Cash out ({data.seats}× {data.seatPlan}, {num(sub.months, 0)} mo)</td>
                <td style={{ ...cell, fontWeight: 600 }}>${num(sub.subscriptionCost, 2)}</td>
              </tr>
              <tr>
                <td style={label}>Effective per steering hour</td>
                <td style={cell}>${num(sub.effectiveCostPerHour, 2)}</td>
              </tr>
              <tr>
                <td style={label}>Meter-equivalent (theoretical, not paid)</td>
                <td style={{ ...cell, opacity: 0.7 }}>${num(sub.meterEquivalent, 2)}</td>
              </tr>
              <tr>
                <td style={label}>Subscription leverage</td>
                <td style={{ ...cell, fontWeight: 600 }}>{sub.leverage.toFixed(1)}×</td>
              </tr>
            </tbody>
          </table>
          <div style={{ ...muted, marginTop: 4 }}>
            {sub.leverage >= 1
              ? "Leverage is on-demand value the flat plan captured — not a saving to pass on as a discount."
              : "The plan costs more than metering at this volume; pay-as-you-go would be cheaper."}
          </div>
        </section>
      ) : (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 4px" }}>Metered basis</h3>
          <div style={muted}>
            No seat plan configured, so costs below are billed meter figures. If capacity is actually bought on a
            subscription, set the plan in Settings — otherwise these numbers are theoretical.
          </div>
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 4px" }}>Meter-equivalent rates</h3>
        <table>
          <tbody>
            <tr>
              <td style={label}>Per steering hour</td>
              <td style={cell}>${num(m.costPerSteeringHour, 2)}</td>
            </tr>
            <tr>
              <td style={label}>Per steering day</td>
              <td style={cell}>${num(m.costPerSteeringDay, 2)}</td>
            </tr>
            <tr>
              <td style={label}>Per active month</td>
              <td style={cell}>${num(m.meterPerMonth, 2)}</td>
            </tr>
            <tr>
              <td style={label}>Cache-read share of tokens</td>
              <td style={cell}>{(m.cacheReadShare * 100).toFixed(1)}%</td>
            </tr>
            <tr>
              <td style={label}>Assistant turns per human turn</td>
              <td style={cell}>{m.assistantPerHumanTurn.toFixed(1)} : 1</td>
            </tr>
          </tbody>
        </table>
        {m.unmeteredHourShare > 0.01 && (
          <div style={{ ...muted, marginTop: 4 }}>
            {(m.unmeteredHourShare * 100).toFixed(1)}% of hours ran on models the meter priced at $0 (routed or
            subscription-billed) — the rates above are understated by that much.
          </div>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 4px" }}>By project</h3>
        <table>
          <thead>
            <tr>
              <th style={label}>Project</th>
              <th style={cell}>Sessions</th>
              <th style={cell}>Active h</th>
              <th style={cell}>Steering days</th>
              <th style={cell}>Meter $</th>
              <th style={cell}>$/h</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.slice(0, 25).map((row) => (
              <tr key={row.project}>
                <td style={label}>{row.project}</td>
                <td style={cell}>{num(row.sessions)}</td>
                <td style={cell}>{num(row.activeHours, 1)}</td>
                <td style={cell}>{num(row.steeringDays, 1)}</td>
                <td style={cell}>{num(row.cost, 0)}</td>
                <td style={cell}>{num(row.costPerHour, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div style={{ ...muted, marginTop: 16 }}>
        Active time counts hours where a human was engaged with the session. It is not billable-hours truth, and it does
        not capture work done outside the agent.
      </div>
    </div>
  );
}

/** Seat-plan options: stored value → label. Unset plan = "metered". */
const SEAT_PLANS = [
  { value: "metered", label: "Metered (pay as you go)" },
  { value: "anthropic-pro", label: "Claude Pro · $20" },
  { value: "anthropic-max-5x", label: "Claude Max 5× · $100" },
  { value: "anthropic-max-20x", label: "Claude Max 20× · $200" },
  { value: "openai-plus", label: "ChatGPT Plus · $20" },
  { value: "openai-pro-5x", label: "ChatGPT Pro 5× · $100" },
  { value: "openai-pro-20x", label: "ChatGPT Pro 20× · $200" },
  { value: "glm-lite", label: "GLM Coding Lite · $18" },
  { value: "glm-pro", label: "GLM Coding Pro · $72" },
  { value: "glm-max", label: "GLM Coding Max · $160" },
  { value: "custom", label: "Custom…" },
];

type EditableKey = "seatPlan" | "seatMonthlyUsd" | "seats" | "gapCapMinutes";
type Edits = Partial<Pick<CostEstimatorConfig, EditableKey>>;

/** Defaults the page SHOWS when a key is unset (never written unless edited). */
const DEFAULTS: Required<Edits> = {
  gapCapMinutes: 15,
  seatPlan: "metered",
  seatMonthlyUsd: 0,
  seats: 1,
};

const isWhole = (n: number) => Number.isInteger(n);

/** Range checks; `NaN` (an emptied field) is always invalid, never coerced to 0. */
function validate(values: Pick<CostEstimatorConfig, EditableKey>): Partial<Record<EditableKey, string>> {
  const errors: Partial<Record<EditableKey, string>> = {};
  if (values.seatPlan === "custom" && !(values.seatMonthlyUsd >= 0)) {
    errors.seatMonthlyUsd = "Enter a price of 0 or more.";
  }
  if (!(isWhole(values.seats) && values.seats >= 1)) errors.seats = "Enter a whole number of 1 or more.";
  if (!(isWhole(values.gapCapMinutes) && values.gapCapMinutes >= 1 && values.gapCapMinutes <= 120)) {
    errors.gapCapMinutes = "Enter a whole number from 1 to 120.";
  }
  return errors;
}

/**
 * CostSettings — seat plan configuration. Claimed on settings-section.
 *
 * Edits are held as a draft on the host Save bar (`plugin:cost-estimator`): no write per
 * keystroke, commit sends ONLY the edited keys (the server merges), an emptied or
 * out-of-range number blocks the commit. Unedited keys follow `plugin_config_update`.
 * See change: retro-ux-plugin-settings-wave-2.
 */
export function CostSettings() {
  const config = usePluginConfig<Partial<CostEstimatorConfig>>();
  const send = usePluginSend();
  const [edits, setEdits] = useState<Edits>({});

  // A broadcast that now equals an edit settles it (saved here or elsewhere), so a
  // stale edit never shadows a later broadcast.
  useEffect(() => {
    setEdits((prev) => {
      const keys = (Object.keys(prev) as EditableKey[]).filter((k) => prev[k] === config[k]);
      if (keys.length === 0) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }, [config]);

  const value = <K extends EditableKey>(key: K): CostEstimatorConfig[K] =>
    (key in edits ? edits[key] : (config[key] ?? DEFAULTS[key])) as CostEstimatorConfig[K];
  const values = {
    seatPlan: value("seatPlan"),
    seatMonthlyUsd: value("seatMonthlyUsd"),
    seats: value("seats"),
    gapCapMinutes: value("gapCapMinutes"),
  };
  const errors = validate(values);

  // Only keys that differ from what is stored; the custom price is owned only by the custom plan.
  const changed: Edits = {};
  for (const k of Object.keys(edits) as EditableKey[]) {
    if (k === "seatMonthlyUsd" && values.seatPlan !== "custom") continue;
    if (edits[k] !== config[k]) (changed as Record<string, unknown>)[k] = edits[k];
  }
  const isDirty = Object.keys(changed).length > 0;

  const latest = useRef({ changed, errors });
  latest.current = { changed, errors };
  const commit = useCallback(async () => {
    const { changed: payload, errors: errs } = latest.current;
    if (Object.keys(errs).length > 0) throw new Error("Fix the invalid fields before saving.");
    if (Object.keys(payload).length === 0) return;
    await send({ type: "plugin_config_write", id: "cost-estimator", config: payload });
  }, [send]);
  const reset = useCallback(() => setEdits({}), []);
  useSettingsDraftSource({ id: "plugin:cost-estimator", isDirty, commit, reset });

  // Setting a field back to its stored value drops the edit (no ghost draft that a
  // later broadcast would turn into an edit). doubt-review 4.50 #1.
  const edit = (patch: Edits) =>
    setEdits((prev) => {
      const next: Edits = { ...prev, ...patch };
      for (const k of Object.keys(patch) as EditableKey[]) if (next[k] === config[k]) delete next[k];
      return next;
    });
  const state = (key: EditableKey) => (values[key] === DEFAULTS[key] ? "default" : "changed");

  return (
    <div data-testid="cost-settings" className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)]">
        Sessions are priced at metered API rates. If you pay for a subscription instead, pick it here so cost reports
        show what you really pay.
      </p>

      <SelectField
        label="Subscription"
        hint="The plan each seat is on. Metered keeps API prices."
        value={values.seatPlan}
        options={SEAT_PLANS}
        onChange={(seatPlan) => edit({ seatPlan })}
        state={state("seatPlan")}
        testIds={{ control: "cost-seat-plan" }}
      />

      {values.seatPlan === "custom" && (
        <NumberField
          label="Price per seat"
          unit="USD / month"
          hint="What one seat costs per month."
          value={values.seatMonthlyUsd}
          decimal
          allowEmpty
          step="any"
          onChange={(seatMonthlyUsd) => edit({ seatMonthlyUsd })}
          error={errors.seatMonthlyUsd}
          state={state("seatMonthlyUsd")}
          testIds={{ control: "cost-seat-monthly" }}
        />
      )}

      <NumberField
        label="Seats"
        hint="How many people share the plan."
        value={values.seats}
        allowEmpty
        onChange={(seats) => edit({ seats })}
        error={errors.seats}
        state={state("seats")}
        testIds={{ control: "cost-seats" }}
      />

      <NumberField
        label="Break after"
        unit="min"
        hint="Idle gaps longer than this don't count as active time. 1–120."
        value={values.gapCapMinutes}
        allowEmpty
        onChange={(gapCapMinutes) => edit({ gapCapMinutes })}
        error={errors.gapCapMinutes}
        state={state("gapCapMinutes")}
        testIds={{ control: "cost-gap-cap" }}
      />
    </div>
  );
}
