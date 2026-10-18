/**
 * Browser settings section — the `settings-section` claim (change:
 * add-browser-relay, task 4.1 / spec `browser-plugin-settings` "Browser
 * settings section").
 *
 * One row per `GET /api/browser/profiles` entry, keyed by `profileDirectory`:
 * label, email, `installed`, `hasToken`, live instances with tab counts, a
 * WRITE-ONLY token input, a `Zero-dialog` toggle (only usable once a token is
 * set), an `allowedDomains` editor, per-instance `Connect`/`Disconnect`, and a
 * per-profile `AuditList`. The global `Enabled` toggle is the relay kill
 * switch (`PUT /api/browser/enabled`).
 *
 * TOKEN SAFETY: the token is never rendered. The input is `type="password"`
 * with a local draft that clears on save; a save goes through the plugin's own
 * `PUT /api/browser/profile` route (merged server-side against the UNREDACTED
 * config), so other profiles' tokens survive and no token round-trips through
 * the client.
 *
 * Electron only: a "This computer" block (`ThisComputerBlock`) lists the local
 * machine's profiles, a write-only local token input and the stored operator
 * consents. The rows above stay dashboard-host only.
 *
 * Layout (change: add-dedicated-agent-browser, design D12, mockups/index.html):
 * Enabled toggle → "Agent browsing" group (`AgentBrowsingGroup`) → "Dedicated
 * agent profile" panel (`DedicatedProfilePanel`, only when the server reports
 * `status.dedicated`) → "My Chrome profiles" (installed + synthetic rows
 * expanded, profiles without the extension behind ONE disclosure with store
 * links and no Connect). Settings values come from `status.settings`, else the
 * plugin config, else the schema defaults.
 *
 * See change: add-browser-relay (task 4.1); add-operator-browser-relay (task 8.3);
 * add-dedicated-agent-browser (tasks 7.1–7.3).
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { AgentBrowsingGroup, resolveAgentSettings } from "./AgentBrowsingGroup.js";
import { AuditList } from "./AuditList.js";
import {
  type AgentBrowsingSettings,
  type BrowserProfilePatch,
  type BrowserProfilesResponse,
  type BrowserRouteProfile,
  type BrowserSettingsPatch,
  type BrowserStatusResponse,
  connectBrowserProfile,
  disconnectBrowserInstance,
  getBrowserProfiles,
  getBrowserStatus,
  PLAYWRIGHT_EXTENSION_STORE_URL,
  putBrowserSettings,
  type RelayConfig,
  setBrowserEnabled,
  writeBrowserProfile,
} from "./browser-api.js";
import { getBrowserHost } from "./browser-host.js";
import { DedicatedProfilePanel } from "./DedicatedProfilePanel.js";
import { GROUP, HELP, INPUT, Notice, Pill } from "./settings-ui.js";
import { ThisComputerBlock } from "./ThisComputerBlock.js";

/** Drop local overrides the server has echoed back (equal value in `status.settings`). */
function pruneEchoed(
  overrides: Partial<AgentBrowsingSettings>,
  echoed: Partial<AgentBrowsingSettings> | undefined,
): Partial<AgentBrowsingSettings> {
  if (!echoed) return overrides;
  const next: Record<string, unknown> = { ...overrides };
  for (const key of Object.keys(next)) {
    const server = (echoed as Record<string, unknown>)[key];
    if (server !== undefined && JSON.stringify(server) === JSON.stringify(next[key])) delete next[key];
  }
  return next as Partial<AgentBrowsingSettings>;
}

export function BrowserSettings(): React.ReactElement {
  const t = useT();
  const [status, setStatus] = useState<BrowserStatusResponse | null>(null);
  const [profiles, setProfiles] = useState<BrowserProfilesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const config = usePluginConfig<RelayConfig>();
  // Written values the server has not echoed yet (status.settings / config broadcast).
  const [overrides, setOverrides] = useState<Partial<AgentBrowsingSettings>>({});
  const [settingsError, setSettingsError] = useState(false);

  const refetch = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextStatus, nextProfiles] = await Promise.all([
        getBrowserStatus(signal),
        getBrowserProfiles(signal),
      ]);
      if (signal?.aborted) return;
      setStatus(nextStatus);
      setProfiles(nextProfiles);
      setOverrides((prev) => pruneEchoed(prev, nextStatus.settings));
      setFailed(false);
    } catch {
      if (signal?.aborted) return;
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refetch(controller.signal);
    return () => controller.abort();
  }, [refetch]);

  /** One partial `PUT /api/browser/settings`; shown optimistically, restored on rejection. */
  const applySettings = useCallback(
    (patch: BrowserSettingsPatch) => {
      setSettingsError(false);
      setOverrides((prev) => ({ ...prev, ...patch }));
      void (async () => {
        try {
          await putBrowserSettings(patch);
          await refetch();
        } catch {
          setOverrides((prev) => {
            const next: Record<string, unknown> = { ...prev };
            for (const key of Object.keys(patch)) delete next[key];
            return next as Partial<AgentBrowsingSettings>;
          });
          setSettingsError(true);
        }
      })();
    },
    [refetch],
  );

  if (failed) {
    return (
      <p data-testid="browser-settings-error" className="text-xs text-[var(--text-secondary)]">
        {t("settingsError", undefined, "Browser relay settings are unavailable.")}
      </p>
    );
  }

  if (!status || !profiles) {
    return (
      <p data-testid="browser-settings-loading" className="text-xs text-[var(--text-tertiary)]">
        {t("loading", undefined, "Loading…")}
      </p>
    );
  }

  const rows = Object.values(profiles.profiles);
  const installedRows = rows.filter((p) => p.installed);
  const uninstalledRows = rows.filter((p) => !p.installed);
  const settings = resolveAgentSettings(config, status.settings, overrides);
  // Electron main window only (local-origin preload); absent in a plain browser.
  const browserHost = getBrowserHost();

  return (
    <div className="space-y-4" data-testid="browser-settings">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("settingsIntro", undefined, "Relay your logged-in Chrome to a pi session through the Playwright extension.")}
      </p>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          data-testid="browser-enabled-toggle"
          checked={status.enabled}
          onChange={(e) => {
            void (async () => {
              try {
                await setBrowserEnabled(e.target.checked);
                await refetch();
              } catch {
                setFailed(true);
              }
            })();
          }}
        />
        {t("enabledLabel", undefined, "Enabled")}
      </label>

      <AgentBrowsingGroup
        settings={settings}
        enabled={status.enabled}
        canOpenChrome={status.canOpenChrome}
        dedicatedAvailable={status.dedicated?.available ?? false}
        installedProfiles={installedRows}
        error={settingsError}
        onChange={applySettings}
      />

      {status.dedicated && (
        <DedicatedProfilePanel dedicated={status.dedicated} enabled={status.enabled} onRefetch={refetch} />
      )}

      <section aria-labelledby="browser-profiles-heading" className={`${GROUP} !space-y-2`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="browser-profiles-heading" className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t("profilesTitle", undefined, "My Chrome profiles")}
          </h3>
          <span className={HELP}>{t("profilesNeedsExtension", undefined, "Needs the Playwright extension in each profile.")}</span>
        </div>

        {!status.canOpenChrome && (
          <Notice tone="info" testId="browser-cannot-open-chrome">
            {t("cannotOpenChrome", undefined, "This host cannot open Chrome automatically. Start Chrome with the relay extension yourself, then connect.")}
          </Notice>
        )}

        {profiles.warning && (
          <p data-testid="browser-profiles-warning" className="text-xs text-[var(--text-tertiary)]">
            {t("profilesWarning", { path: profiles.warning }, `Could not read Chrome profiles (${profiles.warning}); showing a default profile.`)}
          </p>
        )}

        {rows.length === 0 ? (
          <p data-testid="browser-profiles-empty" className="text-xs text-[var(--text-tertiary)]">
            {t("noProfiles", undefined, "No Chrome profiles found.")}
          </p>
        ) : (
          <>
            {installedRows.length > 0 && (
              <div data-testid="browser-installed-profiles" className="space-y-2">
                {installedRows.map((profile) => (
                  <ProfileRow key={profile.profileDirectory} profile={profile} status={status} onRefetch={refetch} />
                ))}
              </div>
            )}
            {uninstalledRows.length > 0 && <UninstalledProfiles rows={uninstalledRows} />}
          </>
        )}
      </section>

      {browserHost && <ThisComputerBlock bridge={browserHost} />}
    </div>
  );
}

/** Profiles without the extension: one disclosure, store link per row, no Connect. */
function UninstalledProfiles({ rows }: { rows: readonly BrowserRouteProfile[] }): React.ReactElement {
  const t = useT();
  const n = rows.length;
  return (
    <details className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
      <summary
        data-testid="browser-uninstalled-disclosure"
        className="cursor-pointer px-2.5 py-2 min-h-[44px] sm:min-h-0 flex items-center text-xs text-[var(--text-secondary)]"
      >
        {n === 1
          ? t("uninstalledSummaryOne", undefined, "1 more profile without the extension")
          : t("uninstalledSummary", { n }, `${n} more profiles without the extension`)}
      </summary>
      <ul data-testid="browser-uninstalled-profiles" className="space-y-1 px-3 pb-3 text-xs">
        {rows.map((profile) => {
          const dir = profile.profileDirectory;
          return (
            <li key={dir} data-testid={`browser-profile-${dir}`} className="flex items-center justify-between gap-2">
              <span data-testid={`browser-profile-label-${dir}`} className="truncate text-[var(--text-secondary)]">
                {profile.email ?? profile.label} <span className="text-[var(--text-tertiary)]">({dir})</span>
              </span>
              <a
                data-testid={`browser-store-link-${dir}`}
                href={PLAYWRIGHT_EXTENSION_STORE_URL}
                target="_blank"
                rel="noreferrer"
                className="flex-none underline text-[var(--accent-text)]"
              >
                {t("installExtension", undefined, "Install the Playwright extension")}
              </a>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ProfileRow({
  profile,
  status,
  onRefetch,
}: {
  profile: BrowserRouteProfile;
  status: BrowserStatusResponse;
  onRefetch: (signal?: AbortSignal) => Promise<void>;
}): React.ReactElement {
  const t = useT();
  const config = usePluginConfig<RelayConfig>();

  const dir = profile.profileDirectory;
  const saved = config.browsers?.[dir];

  const [tokenDraft, setTokenDraft] = useState("");
  const [zeroDialog, setZeroDialog] = useState<boolean>(saved?.zeroDialog ?? false);
  const [domainsDraft, setDomainsDraft] = useState(
    (saved?.allowedDomains ?? []).join(", "),
  );
  const [busy, setBusy] = useState(false);

  // Late-arriving config hydration (/api/config) may populate the map after
  // first paint; mirror it while the user has not typed.
  const savedZeroDialog = saved?.zeroDialog ?? false;
  useEffect(() => {
    setZeroDialog(savedZeroDialog);
  }, [savedZeroDialog]);

  const writeBrowserConfig = useCallback(
    async (patch: BrowserProfilePatch) => {
      await writeBrowserProfile(dir, patch);
    },
    [dir],
  );

  const withBusy = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const passwordManagers = profile.passwordManagers ?? [];
  const tabCount = profile.instances.reduce((n, instance) => n + instance.tabs.length, 0);

  return (
    <div
      data-testid={`browser-profile-${dir}`}
      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-2.5 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 data-testid={`browser-profile-label-${dir}`} className="text-[13px] font-medium truncate">
            {profile.label}
          </h4>
          {profile.email && (
            <span data-testid={`browser-profile-email-${dir}`} className="block text-[11px] text-[var(--text-tertiary)] truncate">
              {profile.email}
            </span>
          )}
        </div>
        {passwordManagers.length > 0 && (
          <Pill tone="warn" testId={`browser-password-manager-pill-${dir}`}>
            {t("passwordManagerPill", undefined, "Password manager")}
          </Pill>
        )}
        <div className="flex flex-col items-end text-[10px] text-[var(--text-tertiary)] flex-none">
          <span data-testid={`browser-installed-${dir}`}>
            {profile.installed ? t("installed", undefined, "Extension installed") : t("notInstalled", undefined, "Extension not installed")}
          </span>
          <span data-testid={`browser-has-token-${dir}`}>
            {profile.hasToken ? t("tokenSet", undefined, "Token set") : t("tokenMissing", undefined, "No token")}
          </span>
          <span data-testid={`browser-connected-${dir}`}>
            {profile.instances.length === 0
              ? t("notConnected", undefined, "Not connected")
              : t("connectedTabs", { n: tabCount }, `Connected · ${tabCount} tabs`)}
          </span>
        </div>
      </div>

      {passwordManagers.length > 0 && (
        <Notice tone="warn" testId={`browser-password-manager-${dir}`}>
          {t(
            "passwordManagerWarning",
            { names: passwordManagers.join(", ") },
            `${passwordManagers.join(", ")} run in this profile. The agent disconnects on pages with a password field. Use the dedicated profile for sign-ins.`,
          )}
        </Notice>
      )}

      <div className="flex items-center gap-1.5 text-xs">
        <input
          type="password"
          autoComplete="off"
          data-testid={`browser-token-input-${dir}`}
          value={tokenDraft}
          onChange={(e) => setTokenDraft(e.target.value)}
          placeholder={t("tokenPlaceholder", undefined, "Paste pairing token")}
          className="flex-1 min-w-0 px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]"
        />
        <button
          type="button"
          data-testid={`browser-token-save-${dir}`}
          disabled={tokenDraft.length === 0 || busy}
          onClick={() =>
            withBusy(async () => {
              await writeBrowserConfig({ token: tokenDraft });
              setTokenDraft("");
              await onRefetch();
            })
          }
          className="flex-none px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
        >
          {t("saveToken", undefined, "Save token")}
        </button>
      </div>

      <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          data-testid={`browser-zero-dialog-${dir}`}
          checked={zeroDialog}
          disabled={!profile.hasToken || busy}
          onChange={(e) => {
            const next = e.target.checked;
            setZeroDialog(next);
            void withBusy(() => writeBrowserConfig({ zeroDialog: next }));
          }}
        />
        <span>
          {t("zeroDialogLabel", undefined, "Zero-dialog (skip Chrome's Allow prompt)")}
          <span className="block text-[11px] text-[var(--text-tertiary)]">
            {t("zeroDialogHelp", undefined, "Requires a valid token. A mismatched token, Reject, or no answer all appear as a 60 s timeout.")}
          </span>
        </span>
      </label>

      <label className="block text-xs text-[var(--text-secondary)]">
        <span className="block">{t("allowedDomainsLabel", undefined, "Allowed domains")}</span>
        <input
          data-testid={`browser-allowed-domains-${dir}`}
          value={domainsDraft}
          placeholder={t("allowedDomainsPlaceholder", undefined, "Empty: global list applies")}
          onChange={(e) => setDomainsDraft(e.target.value)}
          onBlur={() => {
            const allowedDomains = domainsDraft
              .split(",")
              .map((d) => d.trim())
              .filter((d) => d.length > 0);
            void withBusy(() => writeBrowserConfig({ allowedDomains }));
          }}
          className={`${INPUT} mt-1`}
        />
        <span className="block text-[11px] text-[var(--text-tertiary)]">
          {t("allowedDomainsHelp", undefined, "Guards address-bar navigation and new tabs only; scripts, link clicks and redirects can still leave the list.")}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status.canOpenChrome && (
          <button
            type="button"
            data-testid={`browser-connect-${dir}`}
            disabled={!profile.installed || !status.enabled || busy}
            onClick={() =>
              withBusy(async () => {
                await connectBrowserProfile(dir);
                await onRefetch();
              })
            }
            className="px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            {t("connect", undefined, "Connect")}
          </button>
        )}
        {!status.enabled && (
          <span data-testid={`browser-disabled-reason-${dir}`} className="text-[var(--text-tertiary)]">
            {t("relayDisabled", undefined, "Browser relay disabled")}
          </span>
        )}
      </div>

      {profile.instances.map((instance) => (
        <div
          key={instance.instanceId}
          data-testid={`browser-instance-${instance.instanceId}`}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="text-[var(--text-secondary)]">
            {t("instanceTabs", { n: instance.tabs.length }, `${instance.tabs.length} tabs`)}
          </span>
          <button
            type="button"
            data-testid={`browser-disconnect-${instance.instanceId}`}
            disabled={!status.enabled || busy}
            onClick={() =>
              withBusy(async () => {
                await disconnectBrowserInstance(instance.instanceId);
                await onRefetch();
              })
            }
            className="px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            {t("disconnect", undefined, "Disconnect")}
          </button>
        </div>
      ))}

      <AuditList profileDirectory={dir} />
    </div>
  );
}
