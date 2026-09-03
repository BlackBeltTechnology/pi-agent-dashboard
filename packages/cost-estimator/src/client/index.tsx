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
import React, { useEffect, useState } from "react";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";

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

/** CostSettings — seat plan configuration. Claimed on settings-section. */
export function CostSettings() {
  const config = usePluginConfig<CostEstimatorConfig>();
  const send = usePluginSend();

  const write = (partial: Partial<CostEstimatorConfig>) =>
    send({ type: "plugin_config_write", id: "cost-estimator", config: { ...config, ...partial } });

  return (
    <div data-testid="cost-settings" style={{ fontSize: 12 }}>
      <div style={{ ...muted, marginBottom: 6 }}>
        Session cost is recorded as a metered API price. If capacity is bought on a subscription, set the plan here so
        the dashboard reports real cash rather than a theoretical meter.
      </div>

      <label style={{ display: "block", marginBottom: 6 }}>
        Seat plan{" "}
        <select
          data-testid="cost-seat-plan"
          value={config.seatPlan ?? "anthropic-max-20x"}
          onChange={(event) => write({ seatPlan: event.target.value })}
        >
          <option value="metered">Metered (pay-as-you-go)</option>
          <option value="anthropic-pro">Claude Pro — $20</option>
          <option value="anthropic-max-5x">Claude Max 5× — $100</option>
          <option value="anthropic-max-20x">Claude Max 20× — $200</option>
          <option value="openai-plus">ChatGPT Plus — $20</option>
          <option value="openai-pro-5x">ChatGPT Pro 5× — $100</option>
          <option value="openai-pro-20x">ChatGPT Pro 20× — $200</option>
          <option value="glm-lite">GLM Coding Lite — $18</option>
          <option value="glm-pro">GLM Coding Pro — $72</option>
          <option value="glm-max">GLM Coding Max — $160</option>
          <option value="custom">Custom…</option>
        </select>
      </label>

      {config.seatPlan === "custom" && (
        <label style={{ display: "block", marginBottom: 6 }}>
          USD per seat per month{" "}
          <input
            data-testid="cost-seat-monthly"
            type="number"
            min={0}
            value={config.seatMonthlyUsd ?? 0}
            onChange={(event) => write({ seatMonthlyUsd: Number(event.target.value) })}
          />
        </label>
      )}

      <label style={{ display: "block", marginBottom: 6 }}>
        Seats{" "}
        <input
          data-testid="cost-seats"
          type="number"
          min={1}
          value={config.seats ?? 1}
          onChange={(event) => write({ seats: Number(event.target.value) })}
        />
      </label>

      <label style={{ display: "block" }}>
        Break threshold (minutes){" "}
        <input
          data-testid="cost-gap-cap"
          type="number"
          min={1}
          max={120}
          value={config.gapCapMinutes ?? 15}
          onChange={(event) => write({ gapCapMinutes: Number(event.target.value) })}
        />
      </label>
    </div>
  );
}
