/**
 * apple-tools · CLIENT entry.
 *
 * A settings-section rendered inline beneath the plugin's own row in the
 * Plugins tab (no `tab` field — per dashboard-plugin-loader spec it renders
 * only under the owning plugin's row). A provisioning surface, NOT a service
 * switchboard: it shows the shared checker's terminal state, offers
 * [Run installer], a path override, directTools selection, and a server
 * enable/disable toggle — but NO per-Apple-service toggles (TCC is menu-bar
 * only, no API).
 *
 * See change: add-apple-tools-imcp-plugin (Decision 5).
 */
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { useEffect, useState } from "react";

const PLUGIN_ID = "apple-tools";
const DEFAULT_PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";

interface AppleToolsConfig {
  imcpServerPath?: string;
}

interface StatusReadout {
  platform: string;
  state: string;
  message: string;
  resolvedPath?: string;
  imcpServerPath: string;
  /** Adapter-owned, read server-side from ~/.pi/agent/mcp.json. */
  directTools: string[];
  disabled: boolean;
  /** False when iMCP.app is absent — provisioning must go through the CLI. */
  appPresent: boolean;
}

export function AppleToolsSettings() {
  const config = usePluginConfig<AppleToolsConfig>();
  const send = usePluginSend();
  const [status, setStatus] = useState<StatusReadout | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState(config?.imcpServerPath ?? DEFAULT_PATH);
  const [directToolsDraft, setDirectToolsDraft] = useState("");

  useEffect(() => {
    setPathDraft(config?.imcpServerPath ?? DEFAULT_PATH);
  }, [config?.imcpServerPath]);

  // directTools + disabled live in ~/.pi/agent/mcp.json (adapter-owned), so the
  // server status readout — not our plugin config — is their source of truth.
  // Key on the VALUE, not the status object identity: re-seeding on every poll
  // would wipe an edit the operator is still typing.
  const serverDirectTools = status?.directTools.join(", ") ?? null;
  useEffect(() => {
    if (serverDirectTools !== null) setDirectToolsDraft(serverDirectTools);
  }, [serverDirectTools]);

  async function refresh(): Promise<void> {
    try {
      const res = await fetch(`/api/${PLUGIN_ID}/status`);
      // A 404/500 body is not a StatusReadout — storing it would render garbage.
      if (!res.ok) {
        setFetchError(`status request failed (${res.status})`);
        return;
      }
      setStatus((await res.json()) as StatusReadout);
      setFetchError(null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only refresh
  useEffect(() => {
    void refresh();
  }, []);

  const isMac = status ? status.platform === "darwin" : true;
  const disabled = status?.disabled === true;
  // #F11: disabled folds into the readout — never READY_PENDING_GRANTS + disabled simultaneously.
  const displayState = disabled ? "DISABLED" : (status?.state ?? "…");

  function saveConfig(partial: AppleToolsConfig): void {
    void send({ type: "plugin_config_write", id: PLUGIN_ID, config: { ...config, ...partial } });
  }

  /** Fire a plugin action, then re-read the status so the panel converges. */
  function act(action: string, payload: Record<string, unknown> = {}): void {
    void send({ type: "plugin_action", pluginId: PLUGIN_ID, action, payload });
    setTimeout(() => void refresh(), 500);
  }

  return (
    <section
      data-testid="apple-tools-settings"
      style={{
        padding: "12px",
        border: "1px solid rgba(82, 82, 91, 0.5)",
        borderRadius: "6px",
        marginBottom: "12px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <h3 style={{ fontSize: "13px", fontWeight: 600, margin: 0 }}>Apple Tools (iMCP)</h3>
        <span style={{ fontSize: "10px", color: "#71717a" }}>apple-tools</span>
      </div>

      <div
        data-testid="apple-tools-status"
        style={{ fontSize: "12px", marginBottom: "8px", fontFamily: "monospace" }}
      >
        {displayState}
      </div>
      {status?.message && (
        <p style={{ fontSize: "11px", color: "#a1a1aa", margin: "0 0 10px 0" }}>{status.message}</p>
      )}
      {fetchError && (
        <p
          data-testid="apple-tools-error"
          style={{ fontSize: "11px", color: "#f87171", margin: "0 0 10px 0" }}
        >
          Could not read provisioning status: {fetchError}
        </p>
      )}

      {!isMac ? (
        <p data-testid="apple-tools-unsupported" style={{ fontSize: "11px", color: "#fbbf24" }}>
          iMCP is macOS-only. Nothing to provision on this platform.
        </p>
      ) : (
        <>
          {status && !status.appPresent ? (
            // The dashboard performs only the fast config-write half of
            // provisioning; the long `brew install --cask` runs from the CLI so
            // a click can never block the server. Tell the operator that here
            // rather than offering a button that would refuse.
            <p
              data-testid="apple-tools-needs-cli"
              style={{ fontSize: "11px", color: "#fbbf24", margin: "0 0 10px 0" }}
            >
              iMCP is not installed. Run <code>pi-apple-tools-install</code> in a terminal to
              install it, then reload this panel.
            </p>
          ) : (
            <button
              data-testid="apple-tools-run-installer"
              onClick={() => act("run-installer")}
              style={{ fontSize: "11px", padding: "3px 10px", marginBottom: "10px" }}
            >
              Run installer
            </button>
          )}

          <label style={{ display: "block", fontSize: "11px", marginBottom: "6px" }}>
            imcp-server path override
            <input
              data-testid="apple-tools-path"
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onBlur={() => saveConfig({ imcpServerPath: pathDraft })}
              style={{ display: "block", width: "100%", fontSize: "11px", fontFamily: "monospace" }}
            />
          </label>

          <label style={{ display: "block", fontSize: "11px", marginBottom: "6px" }}>
            directTools (comma-separated)
            <input
              data-testid="apple-tools-direct-tools"
              value={directToolsDraft}
              onChange={(e) => setDirectToolsDraft(e.target.value)}
              onBlur={() =>
                act("set-direct-tools", {
                  tools: directToolsDraft
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              style={{ display: "block", width: "100%", fontSize: "11px" }}
            />
          </label>

          <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px" }}>
            <input
              data-testid="apple-tools-disabled"
              type="checkbox"
              checked={disabled}
              onChange={(e) => act("set-disabled", { scope: "global", disabled: e.target.checked })}
            />
            Disable the iMCP server globally (writes `disabled` to ~/.pi/agent/mcp.json; a project
            can override this in its own .pi/mcp.json. Menu-bar grants are unaffected.)
          </label>

          <p style={{ fontSize: "10px", color: "#71717a", marginTop: "10px" }}>
            Apple service permissions (Calendar, Contacts, …) are granted only in the iMCP menu-bar
            app and cannot be automated. This panel does not toggle individual services.
          </p>
        </>
      )}
    </section>
  );
}
