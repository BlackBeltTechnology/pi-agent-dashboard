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
 * Wave-2 consistency (change: retro-ux-plugin-settings-wave-2, BR1–BR6): the
 * kill switch is the "Relay connections" `ToggleField`; each profile is a
 * collapsible `SettingsItem` card whose summary keeps status pills visible;
 * profiles without the extension sit in a collapsed "Other Chrome profiles"
 * group. Writes stay immediate (plugin REST routes, no host Save bar); a failed
 * write is an error notice scoped to its profile card (or the relay switch) with
 * "Try again" — never a blanked page. A pairing token is NEVER put in a notice
 * or in "Copy details" (only the HTTP-level error text is).
 *
 * See change: add-browser-relay (task 4.1); add-operator-browser-relay (task 8.3);
 * add-dedicated-agent-browser (tasks 7.1–7.3); retro-ux-plugin-settings-wave-2.
 */

import { SettingsGroup, SettingsItem, SettingsNotice, SettingsStatusPill, ToggleField, usePluginConfig, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
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
import { BlurTextField, BTN, HELP, LINK } from "./settings-ui.js";
import { ThisComputerBlock } from "./ThisComputerBlock.js";

/** The error text only (an HTTP status line) — what "Copy details" may carry; never a request body. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  /** Raw text of the last failed load (copied by "Copy details", never rendered). */
  const [failed, setFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const config = usePluginConfig<RelayConfig>();
  // Written values the server has not echoed yet (status.settings / config broadcast).
  const [overrides, setOverrides] = useState<Partial<AgentBrowsingSettings>>({});
  const [settingsError, setSettingsError] = useState(false);
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<{ next: boolean; details: string } | null>(null);

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
      setFailed(null);
    } catch (error) {
      if (signal?.aborted) return;
      setFailed(errorText(error));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refetch(controller.signal);
    return () => controller.abort();
  }, [refetch]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    try {
      await refetch();
    } finally {
      setRetrying(false);
    }
  }, [refetch]);

  /** `PUT /api/browser/enabled`; a failure leaves the switch where it was and offers a retry. */
  const changeRelay = useCallback(
    async (next: boolean) => {
      setRelayBusy(true);
      setRelayError(null);
      try {
        await setBrowserEnabled(next);
        await refetch();
      } catch (error) {
        setRelayError({ next, details: errorText(error) });
      } finally {
        setRelayBusy(false);
      }
    },
    [refetch],
  );

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

  const loadError =
    failed === null ? null : (
      <SettingsNotice
        tone="error"
        testId="browser-settings-error"
        onRetry={() => void retryLoad()}
        retrying={retrying}
        details={failed}
      >
        {t("settingsError", undefined, "Browser Relay settings are unavailable.")}
      </SettingsNotice>
    );

  if (!status || !profiles) {
    if (loadError) return loadError;
    return (
      <p data-testid="browser-settings-loading" className="text-xs text-[var(--text-secondary)]">
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
      {loadError}

      <p className="text-xs text-[var(--text-secondary)]">
        {t("settingsIntro", undefined, "Relay your logged-in Chrome to a pi session through the Playwright extension.")}
      </p>

      <ToggleField
        label={t("relayConnectionsLabel", undefined, "Relay connections")}
        hint={t("relayConnectionsHint", undefined, "Turn off to block every Chrome profile at once. The plugin stays on.")}
        value={status.enabled}
        disabled={relayBusy}
        onChange={(next) => void changeRelay(next)}
        testIds={{ control: "browser-enabled-toggle" }}
      />

      {relayError && (
        <SettingsNotice
          tone="error"
          testId="browser-relay-error"
          onRetry={() => void changeRelay(relayError.next)}
          retrying={relayBusy}
          details={relayError.details}
        >
          {t("relayChangeFailed", undefined, "Relay connections were not changed. The dashboard server did not answer.")}
        </SettingsNotice>
      )}

      {!status.enabled && (
        <SettingsNotice tone="info" testId="browser-relay-off">
          {t(
            "relayOffNotice",
            undefined,
            "Relay connections are off. No session can reach Chrome until you turn them back on.",
          )}
        </SettingsNotice>
      )}

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

      <section className="space-y-3">
        {!status.canOpenChrome && (
          <SettingsNotice tone="info" testId="browser-cannot-open-chrome">
            {t("cannotOpenChrome", undefined, "This host cannot open Chrome automatically. Start Chrome with the relay extension yourself, then connect.")}
          </SettingsNotice>
        )}

        {profiles.warning && (
          <SettingsNotice tone="warning" testId="browser-profiles-warning" details={profiles.warning}>
            {t("profilesWarningShort", undefined, "Chrome's profile list could not be read. Showing a default profile.")}
          </SettingsNotice>
        )}

        {rows.length === 0 ? (
          <p data-testid="browser-profiles-empty" className="text-xs text-[var(--text-secondary)]">
            {t("noProfiles", undefined, "No Chrome profiles found.")}
          </p>
        ) : (
          <>
            {installedRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {t("profilesTitle", undefined, "Chrome profiles with the extension")}
                  </h3>
                  <span className={HELP}>{t("profilesNeedsExtension", undefined, "Needs the Playwright extension in each profile.")}</span>
                </div>
                <div data-testid="browser-installed-profiles" className="space-y-2">
                  {installedRows.map((profile) => (
                    <ProfileRow key={profile.profileDirectory} profile={profile} status={status} onRefetch={refetch} />
                  ))}
                </div>
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

/** Extension / pairing / connection status as word pills — visible while the card is collapsed. */
function ProfileStatusPills({ profile }: { profile: BrowserRouteProfile }): React.ReactElement {
  const t = useT();
  const dir = profile.profileDirectory;
  const tabCount = profile.instances.reduce((n, instance) => n + instance.tabs.length, 0);
  const passwordManagers = profile.passwordManagers ?? [];
  return (
    <>
      <SettingsStatusPill
        tone={profile.installed ? "success" : "neutral"}
        status={profile.installed ? "installed" : "missing"}
        testId={`browser-installed-${dir}`}
      >
        {profile.installed
          ? t("installed", undefined, "Extension installed")
          : t("extensionMissing", undefined, "Extension missing")}
      </SettingsStatusPill>
      <SettingsStatusPill
        tone={profile.hasToken ? "success" : "neutral"}
        status={profile.hasToken ? "paired" : "unpaired"}
        testId={`browser-has-token-${dir}`}
      >
        {profile.hasToken ? t("paired", undefined, "Paired") : t("notPaired", undefined, "Not paired")}
      </SettingsStatusPill>
      {profile.installed && (
        <SettingsStatusPill
          tone={profile.instances.length === 0 ? "neutral" : "info"}
          status={profile.instances.length === 0 ? "disconnected" : "connected"}
          testId={`browser-connected-${dir}`}
        >
          {profile.instances.length === 0
            ? t("notConnected", undefined, "Not connected")
            : t("connectedTabs", { n: tabCount }, `Connected · ${tabCount} tabs`)}
        </SettingsStatusPill>
      )}
      {passwordManagers.length > 0 && (
        <SettingsStatusPill tone="warning" testId={`browser-password-manager-pill-${dir}`}>
          {t("passwordManagerPill", undefined, "Password manager")}
        </SettingsStatusPill>
      )}
    </>
  );
}

/** Profiles without the extension: one collapsed group, a card with the store link per profile, no Connect. */
function UninstalledProfiles({ rows }: { rows: readonly BrowserRouteProfile[] }): React.ReactElement {
  const t = useT();
  const n = rows.length;
  return (
    <SettingsGroup
      testId="browser-uninstalled-profiles"
      summaryTestId="browser-uninstalled-disclosure"
      title={t("otherProfilesTitle", undefined, "Other Chrome profiles")}
      meta={
        n === 1
          ? t("uninstalledSummaryOne", undefined, "1 · extension missing")
          : t("uninstalledSummary", { n }, `${n} · extension missing`)
      }
      defaultOpen={false}
    >
      {rows.map((profile) => {
        const dir = profile.profileDirectory;
        return (
          <SettingsItem
            key={dir}
            collapsible
            defaultOpen={false}
            testId={`browser-profile-${dir}`}
            summaryTestId={`browser-summary-${dir}`}
            title={<span data-testid={`browser-profile-label-${dir}`}>{profile.label}</span>}
            subtitle={profile.email ?? dir}
            status={<ProfileStatusPills profile={profile} />}
          >
            <p className={HELP}>
              {t("installExtensionHint", undefined, "Install the extension in this Chrome profile to pair it.")}
            </p>
            <a
              data-testid={`browser-store-link-${dir}`}
              // client-sinks: allow — compile-time constant store URL
              href={PLAYWRIGHT_EXTENSION_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className={LINK}
            >
              {t("installExtension", undefined, "Install the Playwright extension")}
            </a>
          </SettingsItem>
        );
      })}
    </SettingsGroup>
  );
}

interface ProfileError {
  text: string;
  /** Raw HTTP-level error text only — never the request (a token travels in the body). */
  details: string;
  retry: () => void;
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
  const [error, setError] = useState<ProfileError | null>(null);

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

  /**
   * Run one profile action with the card's controls disabled. A failure is shown
   * inside THIS card (one sentence + Try again) and never escapes; `onFail`
   * restores optimistic state, `again` overrides what "Try again" re-runs.
   */
  const run = useCallback(
    async (text: string, action: () => Promise<void>, opts: { onFail?: () => void; again?: () => void } = {}) => {
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (caught) {
        opts.onFail?.();
        setError({ text, details: errorText(caught), retry: opts.again ?? (() => void run(text, action, opts)) });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const saveToken = () => {
    const token = tokenDraft;
    void run(t("tokenSaveFailed", undefined, "The token was not saved. The dashboard server did not answer."), async () => {
      await writeBrowserConfig({ token });
      setTokenDraft("");
      await onRefetch();
    });
  };

  const changeZeroDialog = (next: boolean) => {
    const previous = zeroDialog;
    setZeroDialog(next);
    void run(
      t("zeroDialogSaveFailed", undefined, "The setting was not saved. The dashboard server did not answer."),
      () => writeBrowserConfig({ zeroDialog: next }),
      { onFail: () => setZeroDialog(previous), again: () => changeZeroDialog(next) },
    );
  };

  const saveDomains = () => {
    const allowedDomains = domainsDraft
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    void run(
      t("domainsSaveFailed", undefined, "The allowed domains were not saved. The dashboard server did not answer."),
      () => writeBrowserConfig({ allowedDomains }),
    );
  };

  const passwordManagers = profile.passwordManagers ?? [];

  return (
    <SettingsItem
      collapsible
      defaultOpen
      testId={`browser-profile-${dir}`}
      summaryTestId={`browser-summary-${dir}`}
      title={<span data-testid={`browser-profile-label-${dir}`}>{profile.label}</span>}
      subtitle={profile.email ? <span data-testid={`browser-profile-email-${dir}`}>{profile.email}</span> : undefined}
      status={<ProfileStatusPills profile={profile} />}
    >
      {error && (
        <SettingsNotice
          tone="error"
          testId={`browser-error-${dir}`}
          onRetry={error.retry}
          retrying={busy}
          details={error.details}
        >
          {error.text}
        </SettingsNotice>
      )}

      {passwordManagers.length > 0 && (
        <SettingsNotice tone="warning" testId={`browser-password-manager-${dir}`}>
          {t(
            "passwordManagerWarning",
            { names: passwordManagers.join(", ") },
            `${passwordManagers.join(", ")} run in this profile. The agent disconnects on pages with a password field. Use the dedicated profile for sign-ins.`,
          )}
        </SettingsNotice>
      )}

      <BlurTextField
        label={t("tokenLabel", undefined, "Pairing token")}
        hint={
          profile.hasToken
            ? t("tokenHintSaved", undefined, "A token is saved. Paste a new one to replace it.")
            : t("tokenHint", undefined, "Copy the token from the Playwright extension popup in this Chrome profile.")
        }
        type="password"
        testId={`browser-token-input-${dir}`}
        value={tokenDraft}
        onChange={setTokenDraft}
        placeholder={t("tokenPlaceholder", undefined, "Paste pairing token")}
        disabled={busy}
        action={
          <button
            type="button"
            data-testid={`browser-token-save-${dir}`}
            disabled={tokenDraft.length === 0 || busy}
            onClick={saveToken}
            className={`${BTN} flex-none`}
          >
            {t("saveToken", undefined, "Save token")}
          </button>
        }
      />

      <ToggleField
        label={t("zeroDialogLabel", undefined, "Skip Chrome's Allow prompt")}
        hint={
          profile.hasToken
            ? t("zeroDialogHelp", undefined, "Requires a valid token. A mismatched token, Reject, or no answer all appear as a 60 s timeout.")
            : t("zeroDialogNeedsToken", undefined, "Pair this profile first.")
        }
        value={zeroDialog}
        disabled={!profile.hasToken || busy}
        onChange={changeZeroDialog}
        testIds={{ control: `browser-zero-dialog-${dir}` }}
      />

      <BlurTextField
        label={t("allowedDomainsLabel", undefined, "Allowed domains")}
        hint={t("allowedDomainsHelp", undefined, "Guards address-bar navigation and new tabs only; scripts, link clicks and redirects can still leave the list.")}
        testId={`browser-allowed-domains-${dir}`}
        value={domainsDraft}
        placeholder={t("allowedDomainsPlaceholder", undefined, "Empty: global list applies")}
        onChange={setDomainsDraft}
        onBlur={saveDomains}
        disabled={busy}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {status.canOpenChrome && (
          <button
            type="button"
            data-testid={`browser-connect-${dir}`}
            disabled={!profile.installed || !status.enabled || busy}
            onClick={() =>
              void run(
                t("connectFailed", undefined, "This profile could not be connected. The dashboard server did not answer."),
                async () => {
                  await connectBrowserProfile(dir);
                  await onRefetch();
                },
              )
            }
            className={BTN}
          >
            {t("connect", undefined, "Connect")}
          </button>
        )}
        {!status.enabled && (
          <span data-testid={`browser-disabled-reason-${dir}`} className={HELP}>
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
              void run(
                t("disconnectFailed", undefined, "The connection could not be closed. The dashboard server did not answer."),
                async () => {
                  await disconnectBrowserInstance(instance.instanceId);
                  await onRefetch();
                },
              )
            }
            className={BTN}
          >
            {t("disconnect", undefined, "Disconnect")}
          </button>
        </div>
      ))}

      <AuditList profileDirectory={dir} />
    </SettingsItem>
  );
}
