/**
 * apple-tools · CLIENT entry.
 *
 * A settings-section rendered on the plugin's own settings page (no `tab` field —
 * per dashboard-plugin-loader spec it renders only under the owning plugin).
 * A provisioning surface, NOT a service switchboard: it shows the shared
 * checker's terminal state as a word pill (never the raw token) with a notice
 * naming the fix, offers [Run installer] (busy + result notice) and a path
 * override, and links to the mcp-client plugin for server enable/disable +
 * exposure (which live there). No per-Apple-service toggles (TCC is menu-bar
 * only, no API). The host owns identity: no heading or id in the body.
 *
 * The path override is a draft on the host Save bar (`plugin:apple-tools`); the
 * commit sends ONLY `imcpServerPath` (the server merges), so a path the
 * installer reconciles meanwhile is never overwritten by a stale snapshot.
 *
 * A missing `dependsOn: ["mcp-client"]` requirement renders a banner that hides
 * [Run installer] — provisioning would refuse without the service.
 *
 * See changes: add-apple-tools-imcp-plugin (Decision 5), extract-mcp-client-plugin,
 * retro-ux-plugin-settings-wave-2.
 */
import {
  SettingsCopyButton,
  SettingsItem,
  SettingsNotice,
  SettingsStatusPill,
  type SettingsStatusTone,
  TextField,
  useSettingsDraftSource,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { mdiOpenInNew, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

const PLUGIN_ID = "apple-tools";
const DEFAULT_PATH = "/Applications/iMCP.app/Contents/MacOS/imcp-server";
const INSTALL_COMMAND = "pi-apple-tools-install";
/** The generic MCP server manager — where enable/disable + exposure live. */
const MANAGE_MCP_PATH = "/settings/plugins/mcp-client";
/** Plugins index — the missing-dependency banner's Enable affordance. */
const PLUGINS_INDEX_PATH = "/settings/plugins";

const BTN_BASE =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-60";
const BTN_PRIMARY = `${BTN_BASE} bg-[var(--accent-solid)] text-white hover:opacity-90`;
const BTN_SECONDARY = `${BTN_BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`;
const BTN_GHOST = `${BTN_BASE} text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`;

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

interface InstallResult {
  tone: "success" | "info" | "warning";
  text: string;
}

interface PillSpec {
  tone: SettingsStatusTone;
  word: string;
}

/**
 * Provisioning state → pill word. "Checking" and "Not installed" are UI-only
 * labels: a failure member always wins over `appPresent`.
 */
function pillFor(status: StatusReadout | null): PillSpec {
  if (!status) return { tone: "info", word: "Checking" };
  if (status.platform !== "darwin") return { tone: "neutral", word: "Unsupported platform" };
  switch (status.state) {
    case "READY_PENDING_GRANTS":
    case "READY":
      return status.appPresent ? { tone: "success", word: "Installed" } : { tone: "neutral", word: "Not installed" };
    case "OS_TOO_OLD":
      return { tone: "warning", word: "macOS too old" };
    case "OS_VERSION_UNKNOWN":
      return { tone: "warning", word: "macOS version unknown" };
    case "UNSUPPORTED_PLATFORM":
      return { tone: "neutral", word: "Unsupported platform" };
    case "NO_INSTALL_METHOD":
      return { tone: "warning", word: "Can't install automatically" };
    case "INSTALL_FAILED":
      return { tone: "error", word: "Install failed" };
    case "CONFIG_UNPARSEABLE":
      return { tone: "error", word: "Config unreadable" };
    case "CONFIG_WRITE_FAILED":
      return { tone: "error", word: "Config not saved" };
    default:
      return { tone: "neutral", word: "Status unknown" };
  }
}

/** "macOS 14.6.1 is below the minimum supported 15.3." → { running, minimum }. */
function parseOsVersions(message: string): { running?: string; minimum?: string } {
  const m = /macOS\s+(\S+)\s+is below the minimum supported\s+(\d+(?:\.\d+)*)/.exec(message);
  return m ? { running: m[1], minimum: m[2] } : {};
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
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const missingDeps = useMissingDeps();

  // Path draft: `null` = untouched (follows the stored value / broadcasts).
  const stored = config?.imcpServerPath ?? DEFAULT_PATH;
  const [pathEdit, setPathEdit] = useState<string | null>(null);
  // A broadcast that now equals the edit settles it, so a stale edit never shadows a later one.
  useEffect(() => {
    setPathEdit((prev) => (prev !== null && prev.trim() === stored ? null : prev));
  }, [stored]);
  const path = pathEdit ?? stored;
  const pathError = path.trim() === "" ? "Enter the path to imcp-server, or reset to the default." : null;
  const isDirty = pathEdit !== null && pathEdit.trim() !== stored;

  const latest = useRef({ pathEdit, pathError, stored });
  latest.current = { pathEdit, pathError, stored };
  const commit = useCallback(async () => {
    const { pathEdit: edit, pathError: err, stored: current } = latest.current;
    if (err) throw new Error(err);
    if (edit === null || edit.trim() === current) return;
    await send({ type: "plugin_config_write", id: PLUGIN_ID, config: { imcpServerPath: edit.trim() } });
  }, [send]);
  const reset = useCallback(() => setPathEdit(null), []);
  // Typing back the stored path drops the edit (no ghost draft that a later
  // broadcast — e.g. the installer reconciling the path — would turn into an
  // edit that reverts it). doubt-review 4.50 #1.
  const editPath = (v: string) => setPathEdit(v === stored ? null : v);
  useSettingsDraftSource({ id: "plugin:apple-tools", isDirty, commit, reset });

  const refresh = useCallback(async (): Promise<StatusReadout | null> => {
    try {
      const res = await fetch(`/api/${PLUGIN_ID}/status`);
      // A 404/500 body is not a StatusReadout — storing it would render garbage.
      if (!res.ok) {
        setFetchError(`status request failed (${res.status})`);
        return null;
      }
      const next = (await res.json()) as StatusReadout;
      setStatus(next);
      setFetchError(null);
      return next;
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function checkAgain(): Promise<void> {
    setChecking(true);
    setResult(null);
    await refresh();
    setChecking(false);
  }

  /** Fire the installer action, then re-read the status so the panel converges. */
  async function runInstaller(): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      await send({ type: "plugin_action", pluginId: PLUGIN_ID, action: "run-installer", payload: {} });
      await new Promise((r) => setTimeout(r, 500));
      const next = await refresh();
      const word = pillFor(next).word;
      setResult(
        next
          ? { tone: pillFor(next).tone === "success" ? "success" : "info", text: `Installer finished. iMCP now shows: ${word}.` }
          : { tone: "warning", text: "Installer ran, but iMCP could not be checked afterwards. Try Check again." },
      );
    } finally {
      setBusy(false);
    }
  }

  const isMac = status ? status.platform === "darwin" : true;
  const pill = pillFor(fetchError && !status ? null : status);
  const showPill = !(fetchError && !status);
  const notInstalled = pill.word === "Not installed";
  const installed = pill.word === "Installed";
  const noMissing = missingDeps.length === 0;

  const checkAgainButton = (
    <button type="button" className={BTN_GHOST} disabled={checking} onClick={() => void checkAgain()}>
      <Icon path={mdiRefresh} size={0.55} aria-hidden="true" />
      Check again
    </button>
  );
  const installAction = (
    <SettingsCopyButton text={INSTALL_COMMAND} label="Copy command" />
  );
  const details = status ? `${status.state}: ${status.message}` : null;
  const os = status ? parseOsVersions(status.message) : {};

  /** Notice for every state except Installed and Checking (those have their own copy). */
  function stateNotice(): ReactNode {
    if (!status || !isMac) return null;
    switch (pill.word) {
      case "Not installed":
        return noMissing ? (
          <SettingsNotice tone="info" testId="apple-tools-needs-cli" actions={<>{installAction}{checkAgainButton}</>}>
            Install iMCP from a terminal on this Mac, then check again: <code className="font-mono text-[12px]">{INSTALL_COMMAND}</code>
          </SettingsNotice>
        ) : null;
      case "Installed":
        return (
          <SettingsNotice tone="info" testId="apple-tools-notice">
            Grant Calendar, Contacts and other access in the iMCP menu-bar app. This page cannot do it for you.
          </SettingsNotice>
        );
      case "macOS too old":
        return (
          <SettingsNotice tone="warning" testId="apple-tools-notice" details={details} actions={checkAgainButton}>
            {`iMCP needs macOS ${os.minimum ?? "a newer version"}${os.minimum ? " or later" : ""}. ${
              os.running ? `This Mac runs ${os.running}. ` : ""
            }Update macOS, then come back to install iMCP.`}
          </SettingsNotice>
        );
      case "macOS version unknown":
        return (
          <SettingsNotice tone="warning" testId="apple-tools-notice" details={details} actions={checkAgainButton}>
            This Mac's macOS version could not be read. Check it under About This Mac, then check again.
          </SettingsNotice>
        );
      case "Can't install automatically":
        return (
          <SettingsNotice tone="warning" testId="apple-tools-notice" details={details} actions={checkAgainButton}>
            Homebrew isn't available, so iMCP can't be installed for you. Install Homebrew or iMCP yourself, then check again.
          </SettingsNotice>
        );
      case "Install failed":
        return (
          <SettingsNotice tone="error" testId="apple-tools-notice" details={details} actions={<>{installAction}{checkAgainButton}</>}>
            The iMCP install did not finish. Run <code className="font-mono text-[12px]">{INSTALL_COMMAND}</code> in a terminal to see why, then check again.
          </SettingsNotice>
        );
      case "Config unreadable":
        return (
          <SettingsNotice tone="error" testId="apple-tools-notice" details={details} actions={checkAgainButton}>
            The MCP config file could not be read. Fix its JSON syntax, then check again.
          </SettingsNotice>
        );
      case "Config not saved":
        return (
          <SettingsNotice tone="error" testId="apple-tools-notice" details={details} actions={checkAgainButton}>
            The MCP config could not be saved. Make sure the file is writable, then check again.
          </SettingsNotice>
        );
      default:
        return (
          <SettingsNotice tone="warning" testId="apple-tools-notice" details={details} actions={checkAgainButton}>
            iMCP reported a state this page does not know. Check again, or run the installer in a terminal.
          </SettingsNotice>
        );
    }
  }

  return (
    <div data-testid="apple-tools-settings" className="space-y-3">
      {missingDeps.length > 0 && (
        <SettingsNotice tone="warning" testId="apple-tools-missing-deps">
          Provisioning needs <code className="font-mono text-[12px]">{missingDeps.join(", ")}</code>.{" "}
          <a className="font-semibold text-[var(--link)] underline" href={PLUGINS_INDEX_PATH}>
            Enable it in Plugins
          </a>{" "}
          first.
        </SettingsNotice>
      )}

      {fetchError && (
        <SettingsNotice
          tone="error"
          testId="apple-tools-error"
          onRetry={() => void checkAgain()}
          retrying={checking}
          details={fetchError}
        >
          Could not check iMCP on this Mac. The dashboard server did not answer.
        </SettingsNotice>
      )}

      {showPill && (
        <SettingsItem
          title="iMCP"
          subtitle="Apple Calendar, Contacts, Reminders and Messages as MCP tools"
          status={
            <SettingsStatusPill tone={pill.tone} testId="apple-tools-status" status={status?.state}>
              {pill.word}
            </SettingsStatusPill>
          }
          actions={
            isMac && noMissing && status?.appPresent && !notInstalled ? (
              <button
                type="button"
                data-testid="apple-tools-run-installer"
                className={installed ? BTN_SECONDARY : BTN_PRIMARY}
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => void runInstaller()}
              >
                {busy ? "Running installer…" : installed ? "Reinstall" : "Run installer"}
              </button>
            ) : null
          }
        />
      )}

      {!isMac && (
        <SettingsNotice tone="info" testId="apple-tools-unsupported">
          iMCP only runs on macOS, so there is nothing to set up on this computer.
        </SettingsNotice>
      )}

      {stateNotice()}

      {result && (
        <SettingsNotice tone={result.tone} role="status" testId="apple-tools-install-result">
          {result.text}
        </SettingsNotice>
      )}

      {isMac && (
        <>
          <TextField
            label="iMCP server path"
            hint="Change this only if iMCP is installed somewhere other than Applications."
            mono
            value={path}
            onChange={editPath}
            error={pathError}
            state={path === DEFAULT_PATH ? "default" : "changed"}
            onReset={path === DEFAULT_PATH ? undefined : () => editPath(DEFAULT_PATH)}
            testIds={{ control: "apple-tools-path" }}
          />

          <SettingsItem
            title="Tools in sessions"
            subtitle="Turn iMCP on or off and choose which tools sessions get in MCP Client."
            actions={
              <a data-testid="apple-tools-manage-mcp" href={MANAGE_MCP_PATH} className={BTN_SECONDARY}>
                Manage MCP servers
                <Icon path={mdiOpenInNew} size={0.55} aria-hidden="true" />
              </a>
            }
          />

          <SettingsNotice tone="info" testId="apple-tools-permissions">
            Calendar, Contacts and other Apple permissions are granted in the iMCP menu-bar app. This page cannot change them.
          </SettingsNotice>
        </>
      )}
    </div>
  );
}
