/**
 * apple-tools · CLIENT entry.
 *
 * A settings-section rendered inline beneath the plugin's own row in the
 * Plugins tab (no `tab` field — per dashboard-plugin-loader spec it renders
 * only under the owning plugin's row). A provisioning surface, NOT a service
 * switchboard: it shows the shared checker's terminal state, offers
 * [Run installer] and a path override, and links to the mcp-client plugin for
 * server enable/disable + directTools (which moved there). No per-Apple-service
 * toggles (TCC is menu-bar only, no API).
 *
 * A missing `dependsOn: ["mcp-client"]` requirement renders a banner that hides
 * [Run installer] — provisioning would refuse without the service.
 *
 * See changes: add-apple-tools-imcp-plugin (Decision 5), extract-mcp-client-plugin.
 */
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { useEffect, useState } from "react";

const PLUGIN_ID = "apple-tools";
const DEFAULT_PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";
/** The generic MCP server manager — where enable/disable + directTools now live. */
const MANAGE_MCP_PATH = "/settings/plugins/mcp-client";
/** Plugins index — the missing-dependency banner's Enable affordance. */
const PLUGINS_INDEX_PATH = "/settings/plugins";

interface AppleToolsConfig {
  imcpServerPath?: string;
}

interface StatusReadout {
  platform: string;
  state: string;
  message: string;
  resolvedPath?: string;
  imcpServerPath: string;
  /** False when iMCP.app is absent — provisioning must go through the CLI. */
  appPresent: boolean;
}

/**
 * This plugin's own loader row `missingDeps` (a `dependsOn` gap). Fetched from
 * `GET /api/plugins` because the server's row is the single source of truth for
 * the dependency graph. A fetch failure leaves the list empty rather than
 * blocking the panel.
 */
function useMissingDeps(): string[] {
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/plugins");
        if (!res.ok) return;
        const body = (await res.json()) as {
          plugins?: Array<{ id?: string; status?: { missingDeps?: string[] } | null }>;
        };
        const row = (body.plugins ?? []).find((p) => p.id === PLUGIN_ID);
        if (alive) setMissing(row?.status?.missingDeps ?? []);
      } catch {
        /* leave empty */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return missing;
}

export function AppleToolsSettings() {
  const config = usePluginConfig<AppleToolsConfig>();
  const send = usePluginSend();
  const [status, setStatus] = useState<StatusReadout | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState(config?.imcpServerPath ?? DEFAULT_PATH);
  const missingDeps = useMissingDeps();

  useEffect(() => {
    setPathDraft(config?.imcpServerPath ?? DEFAULT_PATH);
  }, [config?.imcpServerPath]);

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

      {missingDeps.length > 0 && (
        <p
          data-testid="apple-tools-missing-deps"
          style={{ fontSize: "11px", color: "#fbbf24", margin: "0 0 10px 0" }}
        >
          Missing dependency: <code>{missingDeps.join(", ")}</code>. Provisioning needs it.{" "}
          <a href={PLUGINS_INDEX_PATH}>Enable it in Plugins</a> first.
        </p>
      )}

      <div
        data-testid="apple-tools-status"
        style={{ fontSize: "12px", marginBottom: "8px", fontFamily: "monospace" }}
      >
        {status?.state ?? "…"}
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
          {missingDeps.length > 0 ? null : status && !status.appPresent ? (
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

          <p style={{ fontSize: "11px", margin: "2px 0 10px 0" }}>
            <a data-testid="apple-tools-manage-mcp" href={MANAGE_MCP_PATH}>
              Manage MCP servers
            </a>{" "}
            — enable/disable iMCP and pick its direct tools there.
          </p>

          <p style={{ fontSize: "10px", color: "#71717a", marginTop: "10px" }}>
            Apple service permissions (Calendar, Contacts, …) are granted only in the iMCP menu-bar
            app and cannot be automated. This panel does not toggle individual services.
          </p>
        </>
      )}
    </section>
  );
}
