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
  directTools?: string[];
  disabled?: boolean;
}

interface StatusReadout {
  platform: string;
  state: string;
  message: string;
  resolvedPath?: string;
  imcpServerPath: string;
  directTools: string[];
}

export function AppleToolsSettings() {
  const config = usePluginConfig<AppleToolsConfig>();
  const send = usePluginSend();
  const [status, setStatus] = useState<StatusReadout | null>(null);
  const [pathDraft, setPathDraft] = useState(config?.imcpServerPath ?? DEFAULT_PATH);
  const [directToolsDraft, setDirectToolsDraft] = useState((config?.directTools ?? []).join(", "));

  useEffect(() => {
    setPathDraft(config?.imcpServerPath ?? DEFAULT_PATH);
    setDirectToolsDraft((config?.directTools ?? []).join(", "));
  }, [config?.imcpServerPath, config?.directTools]);

  async function refresh(): Promise<void> {
    try {
      const res = await fetch(`/api/${PLUGIN_ID}/status`);
      setStatus((await res.json()) as StatusReadout);
    } catch {
      /* leave prior status */
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only refresh
  useEffect(() => {
    void refresh();
  }, []);

  const isMac = status ? status.platform === "darwin" : true;
  const disabled = config?.disabled === true;
  // #F11: disabled folds into the readout — never READY_PENDING_GRANTS + disabled simultaneously.
  const displayState = disabled ? "DISABLED" : (status?.state ?? "…");

  function saveConfig(partial: AppleToolsConfig): void {
    void send({ type: "plugin_config_write", id: PLUGIN_ID, config: { ...config, ...partial } });
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

      {!isMac ? (
        <p data-testid="apple-tools-unsupported" style={{ fontSize: "11px", color: "#fbbf24" }}>
          iMCP is macOS-only. Nothing to provision on this platform.
        </p>
      ) : (
        <>
          <button
            data-testid="apple-tools-run-installer"
            onClick={() => {
              void send({ type: "plugin_action", pluginId: PLUGIN_ID, action: "run-installer" });
              // converge without a manual reload (#F7)
              setTimeout(() => void refresh(), 500);
            }}
            style={{ fontSize: "11px", padding: "3px 10px", marginBottom: "10px" }}
          >
            Run installer
          </button>

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
                saveConfig({
                  directTools: directToolsDraft
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
              onChange={(e) => saveConfig({ disabled: e.target.checked })}
            />
            Disable the iMCP server (writes a project-local override; the menu-bar grants are unaffected)
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
