/**
 * pi-flows · Anthropic Messages Bridge — dashboard client entry.
 *
 * Single contribution at v1: a settings-section that shows peer-probe state
 * across reporting pi sessions and exposes the two env-var toggles.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  usePluginConfig,
  usePluginSend,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import React, { useEffect, useState } from "react";

export { catalog } from "./i18n.js";

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

/**
 * Settings panel — shows peer status table per pi PID and exposes toggles
 * mapped to the package's env-var gate (PI_ANTHROPIC_MESSAGES_*).
 */
export function FlowsAnthropicBridgeSettings() {
  const t = useT();
  const config = usePluginConfig<FlowsAnthropicBridgeConfig>();
  const send = usePluginSend();

  const [sessions, setSessions] = useState<BridgeStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<FlowsAnthropicBridgeConfig>({
    forceCanonical: !!config?.forceCanonical,
    disableCanonical: !!config?.disableCanonical,
  });

  useEffect(() => {
    setDraft({
      forceCanonical: !!config?.forceCanonical,
      disableCanonical: !!config?.disableCanonical,
    });
  }, [config?.forceCanonical, config?.disableCanonical]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const res = await fetch("/api/flows-anthropic-bridge/status");
      const json = (await res.json()) as { sessions?: BridgeStatus[] };
      const list = (json.sessions ?? []).slice().sort((a, b) => a.pid - b.pid);
      setSessions(list);
    } catch {
      /* leave existing list */
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  const allActive = sessions.length > 0 && sessions.every((s) => s.status === "active");
  const banner =
    sessions.length === 0
      ? {
          tone: "muted",
          msg: t(
            "bannerNoSessions",
            undefined,
            "No pi sessions reporting yet. Start a pi session to see status.",
          ),
        }
      : allActive
      ? { tone: "ok", msg: t("bannerActive", undefined, "Bridge active in all pi sessions.") }
      : {
          tone: "warn",
          msg: t(
            "bannerDegraded",
            undefined,
            "One or more peers unavailable. See per-session detail below.",
          ),
        };

  const tone =
    banner.tone === "ok"
      ? { background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }
      : banner.tone === "warn"
      ? { background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24" }
      : { background: "rgba(63, 63, 70, 0.5)", color: "#a1a1aa" };

  return (
    <section
      data-testid="flows-anthropic-bridge-settings"
      style={{
        padding: "12px",
        border: "1px solid rgba(82, 82, 91, 0.5)",
        borderRadius: "6px",
        marginBottom: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "8px" }}>
        <h3 style={{ fontSize: "13px", fontWeight: 600, margin: 0 }}>
          {t("heading", undefined, "pi-flows · Anthropic Messages Bridge")}
        </h3>
        <span style={{ fontSize: "10px", color: "#71717a" }}>flows-anthropic-bridge</span>
      </div>

      <p style={{ fontSize: "11px", color: "#a1a1aa", margin: "0 0 8px 0" }}>
        {t("descForwards", undefined, "Forwards")} <code>@pi/anthropic-messages</code>{" "}
        {t(
          "descHooks",
          undefined,
          "hooks into every pi-flows agent subprocess. Activates only when both peers (",
        )}
        <code>@pi/anthropic-messages</code> {t("descAnd", undefined, "and")}{" "}
        <code>pi-flows</code>{t("descResolve", undefined, ") resolve in the pi process.")}
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          fontSize: "11px",
          padding: "6px 8px",
          borderRadius: "4px",
          marginBottom: "10px",
          ...tone,
        }}
      >
        <span>{banner.msg}</span>
        <button
          data-testid="flows-anthropic-bridge-refresh"
          onClick={() => void refresh()}
          disabled={refreshing}
          style={{
            fontSize: "10px",
            padding: "1px 8px",
            border: "1px solid currentColor",
            borderRadius: "3px",
            background: "transparent",
            color: "inherit",
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          {refreshing ? "…" : t("refresh", undefined, "Refresh")}
        </button>
      </div>

      {sessions.length > 0 && (
        <table
          style={{
            width: "100%",
            fontSize: "11px",
            borderCollapse: "collapse",
            marginBottom: "10px",
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "#a1a1aa" }}>
              <th style={{ padding: "2px 4px" }}>PID</th>
              <th style={{ padding: "2px 4px" }}>{t("colStatus", undefined, "Status")}</th>
              <th style={{ padding: "2px 4px" }}>{PEER_AM}</th>
              <th style={{ padding: "2px 4px" }}>{PEER_FLOWS}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.pid} data-testid={`flows-anthropic-bridge-session-${s.pid}`}>
                <td style={{ padding: "2px 4px", fontFamily: "monospace" }}>{s.pid}</td>
                <td style={{ padding: "2px 4px" }}>{s.status}</td>
                <td style={{ padding: "2px 4px" }}>
                  {s.peers?.[PEER_AM]?.ok
                    ? "✓"
                    : `✗ ${s.peers?.[PEER_AM]?.reason ?? t("peerMissing", undefined, "missing")}`}
                </td>
                <td style={{ padding: "2px 4px" }}>
                  {s.peers?.[PEER_FLOWS]?.ok
                    ? "✓"
                    : `✗ ${s.peers?.[PEER_FLOWS]?.reason ?? t("peerMissing", undefined, "missing")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <fieldset style={{ border: "none", padding: 0, margin: 0, fontSize: "11px" }}>
        <legend style={{ fontSize: "11px", color: "#a1a1aa", padding: 0 }}>
          {t("gateOverrides", undefined, "Gate overrides")}
        </legend>

        <label style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
          <input
            type="checkbox"
            data-testid="flows-anthropic-bridge-force"
            checked={draft.forceCanonical}
            onChange={(e) => setDraft({ ...draft, forceCanonical: e.target.checked })}
          />
          {t("forceLabel", undefined, "Force gate open (any anthropic-messages model — sets")}{" "}
          <code>PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL</code>)
        </label>

        <label style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
          <input
            type="checkbox"
            data-testid="flows-anthropic-bridge-disable"
            checked={draft.disableCanonical}
            onChange={(e) => setDraft({ ...draft, disableCanonical: e.target.checked })}
          />
          {t("disableLabel", undefined, "Disable bridge entirely (sets")}{" "}
          <code>PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL</code>)
        </label>

        <button
          data-testid="flows-anthropic-bridge-save"
          onClick={() =>
            send({
              type: "plugin_config_write",
              id: "flows-anthropic-bridge",
              config: draft,
            })
          }
          style={{
            marginTop: "6px",
            fontSize: "11px",
            padding: "3px 10px",
            border: "1px solid rgba(82, 82, 91, 0.7)",
            borderRadius: "4px",
            background: "rgba(63, 63, 70, 0.4)",
            color: "#e4e4e7",
            cursor: "pointer",
          }}
        >
          {t("save", undefined, "Save")}
        </button>
      </fieldset>
    </section>
  );
}
