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
 * See change: add-browser-relay (task 4.1).
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { AuditList } from "./AuditList.js";
import {
  type BrowserProfilePatch,
  type BrowserProfilesResponse,
  type BrowserRouteProfile,
  type BrowserStatusResponse,
  connectBrowserProfile,
  disconnectBrowserInstance,
  getBrowserProfiles,
  getBrowserStatus,
  PLAYWRIGHT_EXTENSION_STORE_URL,
  type RelayConfig,
  setBrowserEnabled,
  writeBrowserProfile,
} from "./browser-api.js";

export function BrowserSettings(): React.ReactElement {
  const t = useT();
  const [status, setStatus] = useState<BrowserStatusResponse | null>(null);
  const [profiles, setProfiles] = useState<BrowserProfilesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const refetch = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextStatus, nextProfiles] = await Promise.all([
        getBrowserStatus(signal),
        getBrowserProfiles(signal),
      ]);
      if (signal?.aborted) return;
      setStatus(nextStatus);
      setProfiles(nextProfiles);
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

  return (
    <div className="space-y-3" data-testid="browser-settings">
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

      {!status.canOpenChrome && (
        <p data-testid="browser-cannot-open-chrome" className="text-xs text-[var(--text-secondary)]">
          {t("cannotOpenChrome", undefined, "This host cannot open Chrome automatically. Start Chrome with the relay extension yourself, then connect.")}
        </p>
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
        rows.map((profile) => (
          <ProfileRow key={profile.profileDirectory} profile={profile} status={status} onRefetch={refetch} />
        ))
      )}
    </div>
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

  const tabCount = profile.instances.reduce((n, instance) => n + instance.tabs.length, 0);

  return (
    <div
      data-testid={`browser-profile-${dir}`}
      className="rounded border border-[var(--border-secondary)] p-2 space-y-1.5"
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
          onChange={(e) => setDomainsDraft(e.target.value)}
          onBlur={() => {
            const allowedDomains = domainsDraft
              .split(",")
              .map((d) => d.trim())
              .filter((d) => d.length > 0);
            void withBusy(() => writeBrowserConfig({ allowedDomains }));
          }}
          className="w-full px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]"
        />
        <span className="block text-[11px] text-[var(--text-tertiary)]">
          {t("allowedDomainsHelp", undefined, "Guards Page.navigate and Target.createTarget only — not other network traffic.")}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!profile.installed && (
          <a
            data-testid={`browser-store-link-${dir}`}
            href={PLAYWRIGHT_EXTENSION_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="underline text-[var(--accent-text)]"
          >
            {t("installExtension", undefined, "Install the Playwright extension")}
          </a>
        )}
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
