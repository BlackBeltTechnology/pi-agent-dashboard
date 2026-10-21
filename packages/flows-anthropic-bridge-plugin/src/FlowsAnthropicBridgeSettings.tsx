/**
 * pi-flows · Anthropic Messages Bridge — dashboard client entry.
 *
 * Single contribution at v1: a settings-section that shows peer-probe state
 * across reporting pi sessions and a three-way "Bridge gate" over the two
 * env-var overrides. The gate is a draft on the host Save bar
 * (`plugin:flows-anthropic-bridge`); the panel has no Save button of its own.
 *
 * See change: retro-ux-plugin-settings-wave-2.
 */

import { FieldShell, SettingsNotice, SettingsStatusPill, type SettingsStatusTone, SettingsTable, usePluginConfig, usePluginSend, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export interface FlowsAnthropicBridgeConfig {
  forceCanonical: boolean;
  disableCanonical: boolean;
}

interface PeerProbe {
  ok: boolean;
  reason?: string;
}

interface BridgeStatus {
  status: "probing" | "waiting_peers" | "active" | "degraded";
  peers: Record<string, PeerProbe>;
  pid: number;
  at: number;
}

const PEER_AM = "@pi/anthropic-messages";
const PEER_FLOWS = "pi-flows";

/** The three gate options; stored as the two canonical-gate keys. */
type Gate = "auto" | "force" | "off";
const GATES: readonly Gate[] = ["auto", "force", "off"];
const GATE_CONFIG: Record<Gate, FlowsAnthropicBridgeConfig> = {
  auto: { forceCanonical: false, disableCanonical: false },
  force: { forceCanonical: true, disableCanonical: false },
  off: { forceCanonical: false, disableCanonical: true },
};
const GATE_TESTID: Record<Gate, string> = {
  auto: "flows-anthropic-bridge-auto",
  force: "flows-anthropic-bridge-force",
  off: "flows-anthropic-bridge-disable",
};

/** Stored flags → option; both true is contradictory and selects none. */
function gateOf(config: Partial<FlowsAnthropicBridgeConfig> | undefined): Gate | "conflict" {
  const force = !!config?.forceCanonical;
  const disable = !!config?.disableCanonical;
  if (force && disable) return "conflict";
  return force ? "force" : disable ? "off" : "auto";
}

const BTN =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60";

const STATUS_PILL: Record<BridgeStatus["status"], { tone: SettingsStatusTone; key: string; fallback: string }> = {
  active: { tone: "success", key: "statusActive", fallback: "Active" },
  waiting_peers: { tone: "warning", key: "statusWaiting", fallback: "Waiting for peers" },
  degraded: { tone: "warning", key: "statusDegraded", fallback: "Degraded" },
  probing: { tone: "info", key: "statusProbing", fallback: "Checking" },
};

/** Aggregate bridge health across the reporting sessions; carries the Refresh control. */
function SummaryNotice({
  state,
  total,
  inactive,
  action,
}: {
  state: "loading" | "failed" | "ready";
  total: number;
  inactive: number;
  action: ReactNode;
}) {
  const t = useT();
  // A failed first request is reported by the separate error notice.
  if (state === "failed") return null;
  let tone: "info" | "success" | "warning" = "info";
  let text: string;
  if (state === "loading") {
    text = t("loadingSessions", undefined, "Checking sessions…");
  } else if (total === 0) {
    text = t("bannerNoSessions", undefined, "No pi session has reported yet. Start a session to see the bridge status.");
  } else if (inactive === 0) {
    tone = "success";
    text =
      total === 1
        ? t("bannerActiveOne", undefined, "Bridge active in 1 session.")
        : t("bannerActive", { count: total }, `Bridge active in all ${total} sessions.`);
  } else {
    tone = "warning";
    text =
      inactive === 1
        ? t("bannerDegradedOne", { total }, `1 of ${total} sessions is not active, so the bridge is off there.`)
        : t("bannerDegraded", { count: inactive, total }, `${inactive} of ${total} sessions are not active, so the bridge is off there.`);
  }
  return (
    <SettingsNotice tone={tone} role="status" actions={action}>
      {text}
    </SettingsNotice>
  );
}

/**
 * Settings panel — shows peer status table per pi PID and the gate control
 * mapped to the package's env-var gate (PI_ANTHROPIC_MESSAGES_*).
 */
export function FlowsAnthropicBridgeSettings() {
  const t = useT();
  const config = usePluginConfig<FlowsAnthropicBridgeConfig>();
  const send = usePluginSend();

  const [sessions, setSessions] = useState<BridgeStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/flows-anthropic-bridge/status");
      if (!res.ok) throw new Error(`status request failed (${res.status})`);
      const json = (await res.json()) as { sessions?: BridgeStatus[] };
      setSessions((json.sessions ?? []).slice().sort((a, b) => a.pid - b.pid));
      setLoaded(true);
      setFetchError(null);
    } catch (e) {
      // Keep the last good list; surface the failure.
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Gate draft ──────────────────────────────────────────────────────────
  const stored = gateOf(config);
  const [pick, setPick] = useState<Gate | null>(null);
  // A broadcast that now equals the pick settles it, so a stale pick never shadows later config.
  useEffect(() => {
    setPick((p) => (p !== null && p === stored ? null : p));
  }, [stored]);
  const selected: Gate | null = pick ?? (stored === "conflict" ? null : stored);
  const isDirty = pick !== null && pick !== stored;

  const pickRef = useRef(pick);
  pickRef.current = pick;
  const commit = useCallback(async () => {
    const p = pickRef.current;
    if (p === null) return;
    await send({ type: "plugin_config_write", id: "flows-anthropic-bridge", config: { ...GATE_CONFIG[p] } });
  }, [send]);
  const reset = useCallback(() => setPick(null), []);
  useSettingsDraftSource({ id: "plugin:flows-anthropic-bridge", isDirty, commit, reset });
  // Picking the stored gate drops the pick (no ghost draft that a later
  // broadcast would turn into an edit). doubt-review 4.50 #1.
  const choose = (g: Gate) => setPick(g === stored ? null : g);

  const refreshButton = (
    <button
      type="button"
      data-testid="flows-anthropic-bridge-refresh"
      className={BTN}
      disabled={refreshing}
      aria-busy={refreshing || undefined}
      onClick={() => void refresh()}
    >
      {t("refresh", undefined, "Refresh")}
    </button>
  );
  const total = sessions.length;
  const inactive = sessions.filter((s) => s.status !== "active").length;

  const peerCell = (s: BridgeStatus, peer: string) => {
    const p = s.peers?.[peer];
    if (p?.ok) return <SettingsStatusPill tone="success">{t("peerLoaded", undefined, "Loaded")}</SettingsStatusPill>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <SettingsStatusPill tone="error">{t("peerMissing", undefined, "Missing")}</SettingsStatusPill>
        {p?.reason ? <span className="text-[12px] text-[var(--text-secondary)]">{p.reason}</span> : null}
      </span>
    );
  };

  const statusCell = (s: BridgeStatus) => {
    const def = STATUS_PILL[s.status];
    if (!def) {
      return <SettingsStatusPill tone="neutral">{t("statusUnknown", undefined, "Unknown")}</SettingsStatusPill>;
    }
    return (
      <SettingsStatusPill tone={def.tone} status={s.status}>
        {t(def.key, undefined, def.fallback)}
      </SettingsStatusPill>
    );
  };

  const gateLabel: Record<Gate, string> = {
    auto: t("gateAuto", undefined, "Automatic"),
    force: t("gateOn", undefined, "Always on"),
    off: t("gateOff", undefined, "Off"),
  };

  const gateHint = (gate: Gate) => {
    if (gate === "force") {
      return (
        <>
          {t("forceLabel", undefined, "Forces the bridge for every Anthropic Messages model. Sets")}{" "}
          <code className="font-mono text-[12px]">PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL</code>.
        </>
      );
    }
    if (gate === "off") {
      return (
        <>
          {t("disableLabel", undefined, "Turns the bridge off in every session. Sets")}{" "}
          <code className="font-mono text-[12px]">PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL</code>.
        </>
      );
    }
    return (
      <>
        {t("hintAuto", undefined, "The bridge turns on only when both")}{" "}
        <code className="font-mono text-[12px]">{PEER_AM}</code> {t("descAnd", undefined, "and")}{" "}
        <code className="font-mono text-[12px]">{PEER_FLOWS}</code>{" "}
        {t("hintAutoEnd", undefined, "load in a session.")}
      </>
    );
  };

  const onGateKey = (e: KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = GATES[(index + step + GATES.length) % GATES.length];
    choose(next);
    document.getElementById(`flows-anthropic-bridge-gate-${next}`)?.focus();
  };

  return (
    <div data-testid="flows-anthropic-bridge-settings" className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("descForwards", undefined, "Passes")} <code className="font-mono text-[12px]">{PEER_AM}</code>{" "}
        {t("descHooks", undefined, "hooks into every pi-flows agent subprocess.")}
      </p>

      {fetchError ? (
        <SettingsNotice
          tone="error"
          testId="flows-anthropic-bridge-error"
          onRetry={() => void refresh()}
          retrying={refreshing}
          details={fetchError}
        >
          {t("fetchFailed", undefined, "Couldn't refresh the bridge status. The list below may be out of date.")}
        </SettingsNotice>
      ) : null}

      <SummaryNotice
        state={loaded ? "ready" : fetchError ? "failed" : "loading"}
        total={total}
        inactive={inactive}
        action={refreshButton}
      />

      {total > 0 ? (
        <SettingsTable
          caption={t("tableCaption", undefined, "Bridge status per pi session")}
          columns={[t("colSession", undefined, "Session process"), t("colStatus", undefined, "Bridge"), PEER_AM, PEER_FLOWS]}
          rows={sessions.map((s) => ({
            key: String(s.pid),
            testId: `flows-anthropic-bridge-session-${s.pid}`,
            cells: [
              <code key="pid" className="font-mono">
                {s.pid}
              </code>,
              statusCell(s),
              peerCell(s, PEER_AM),
              peerCell(s, PEER_FLOWS),
            ],
          }))}
        />
      ) : null}

      {stored === "conflict" && pick === null ? (
        <SettingsNotice tone="warning" testId="flows-anthropic-bridge-conflict" role="status">
          {t(
            "gateConflict",
            undefined,
            "Both overrides are set, which is contradictory. Pick one option below.",
          )}
        </SettingsNotice>
      ) : null}

      <FieldShell
        label={t("gateOverrides", undefined, "Bridge gate")}
        hint={selected === null ? null : gateHint(selected)}
        state={selected === "auto" ? "default" : "changed"}
        control={({ id, describedBy }) => (
          <div
            id={id}
            role="radiogroup"
            aria-label={t("gateOverrides", undefined, "Bridge gate")}
            aria-describedby={describedBy}
            className="inline-flex overflow-hidden rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-0.5"
          >
            {GATES.map((g, i) => {
              const checked = selected === g;
              // Roving tabindex: the checked option, else the first, is the tab stop.
              const tabStop = selected === null ? i === 0 : checked;
              return (
                <button
                  key={g}
                  id={`flows-anthropic-bridge-gate-${g}`}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={tabStop ? 0 : -1}
                  data-testid={GATE_TESTID[g]}
                  onClick={() => choose(g)}
                  onKeyDown={(e) => onGateKey(e, i)}
                  className={`focus-ring min-h-[32px] rounded px-3 text-[12px] font-semibold ${
                    checked
                      ? "bg-[var(--accent-solid)] text-white"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {gateLabel[g]}
                </button>
              );
            })}
          </div>
        )}
      />
    </div>
  );
}
