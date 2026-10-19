/**
 * "This computer" block of the browser settings section (change:
 * add-operator-browser-relay, task 8.3 / spec `browser-plugin-settings`).
 *
 * Electron main window only: rendered by `BrowserSettings` when
 * `window.piDashboard.browserHost` exists, and nothing otherwise. It lists THIS
 * machine's Chrome profiles (`browserHost.identity()`), a write-only pairing
 * token input per profile (`browserHost.setToken` — main stores it; no HTTP
 * request and no WS message carries it, and it is never rendered back), and the
 * operator's stored "Always allow" consents with a Revoke each.
 *
 * Distinct from the dashboard-host rows: those are server state
 * (`GET /api/browser/profiles` `profiles`); this block is local state and never
 * lists operator profiles in the dashboard rows or vice versa.
 *
 * Wave-2 (change: retro-ux-plugin-settings-wave-2): a `SettingsGroup` with one
 * `SettingsItem` per local profile (status pill word, labelled write-only token
 * field, a failed save = error sentence + "Try again" on that row) and a danger
 * "Revoke" per consent.
 */
import {
  SettingsGroup,
  SettingsItem,
  SettingsNotice,
  SettingsStatusPill,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserHostBridge,
  BrowserHostConsentRow,
  BrowserHostIdentity,
} from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { BlurTextField, BTN, BTN_DANGER, HELP } from "./settings-ui.js";

export function ThisComputerBlock({ bridge }: { bridge: BrowserHostBridge }): React.ReactElement | null {
  const t = useT();
  const [identity, setIdentity] = useState<BrowserHostIdentity | null>(null);
  const [consents, setConsents] = useState<BrowserHostConsentRow[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const loadConsents = useCallback(async () => {
    setConsents(await bridge.listConsents());
  }, [bridge]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [id, rows] = await Promise.all([bridge.identity(), bridge.listConsents()]);
        if (!alive) return;
        setIdentity(id);
        setConsents(rows);
      } catch {
        if (alive) setUnavailable(true); // main refused / unreachable: no block, settings keep working
      }
    })();
    return () => {
      alive = false;
    };
  }, [bridge]);

  if (unavailable || !identity) return null;

  const revoke = async (key: string): Promise<void> => {
    try {
      await bridge.revokeConsent(key);
    } catch {
      /* main refused: the row stays, the reload below shows the truth */
    }
    await loadConsents().catch(() => {});
  };

  return (
    <SettingsGroup testId="browser-this-computer" title={t("thisComputerTitle", undefined, "This computer")}>
      <p className={HELP}>
        {t(
          "thisComputerHelp",
          undefined,
          "Chrome profiles on the computer this app runs on. Pairing tokens stay on this computer and are never sent to the server.",
        )}
      </p>

      {identity.profiles.length === 0 ? (
        <p data-testid="browser-host-profiles-empty" className={HELP}>
          {t("thisComputerNoProfiles", undefined, "No Chrome profiles found on this computer.")}
        </p>
      ) : (
        identity.profiles.map((p) => <HostProfileRow key={p.profileDirectory} bridge={bridge} profile={p} />)
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{t("consentsTitle", undefined, "Allowed connections")}</h4>
        {consents.length === 0 ? (
          <p data-testid="browser-host-consents-empty" className={HELP}>
            {t("consentsEmpty", undefined, "No stored “Always allow”.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {consents.map((c) => (
              <li
                key={c.key}
                data-testid={`browser-host-consent-${c.key}`}
                className="flex items-center justify-between gap-2 text-xs text-[var(--text-primary)]"
              >
                <span className="min-w-0 truncate">
                  {c.serverOrigin} · {c.profileDirectory}
                </span>
                <button
                  type="button"
                  data-testid={`browser-host-consent-revoke-${c.key}`}
                  className={`${BTN_DANGER} flex-none`}
                  onClick={() => void revoke(c.key)}
                >
                  {t("revoke", undefined, "Revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
}

function HostProfileRow({
  bridge,
  profile,
}: {
  bridge: BrowserHostBridge;
  profile: BrowserHostIdentity["profiles"][number];
}): React.ReactElement {
  const t = useT();
  const dir = profile.profileDirectory;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (): Promise<void> => {
    if (draft.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      await bridge.setToken(dir, draft);
      setDraft(""); // only on success, so a failed save can be retried
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsItem
      testId={`browser-host-profile-${dir}`}
      title={profile.label}
      subtitle={profile.email}
      status={
        <SettingsStatusPill
          tone={profile.installed ? "success" : "neutral"}
          testId={`browser-host-installed-${dir}`}
        >
          {profile.installed ? t("installed", undefined, "Extension installed") : t("notInstalled", undefined, "Extension not installed")}
        </SettingsStatusPill>
      }
    >
      <BlurTextField
        label={t("tokenLabel", undefined, "Pairing token")}
        hint={null}
        type="password"
        testId={`browser-host-token-input-${dir}`}
        value={draft}
        onChange={setDraft}
        placeholder={t("tokenPlaceholder", undefined, "Paste pairing token")}
        disabled={busy}
        action={
          <button
            type="button"
            data-testid={`browser-host-token-save-${dir}`}
            disabled={draft.length === 0 || busy}
            className={`${BTN} flex-none`}
            onClick={() => void save()}
          >
            {t("saveToken", undefined, "Save token")}
          </button>
        }
      />
      {failed && (
        <SettingsNotice tone="error" testId={`browser-host-token-error-${dir}`} onRetry={() => void save()} retrying={busy}>
          {t("hostTokenError", undefined, "Could not save the token.")}
        </SettingsNotice>
      )}
    </SettingsItem>
  );
}
