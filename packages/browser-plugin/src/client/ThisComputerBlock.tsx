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
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type {
  BrowserHostBridge,
  BrowserHostConsentRow,
  BrowserHostIdentity,
} from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

const BTN =
  "flex-none px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50";

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
    <section
      data-testid="browser-this-computer"
      aria-labelledby="browser-this-computer-title"
      className="rounded border border-[var(--border-secondary)] p-2 space-y-1.5"
    >
      <h4 id="browser-this-computer-title" className="text-[13px] font-medium">
        {t("thisComputerTitle", undefined, "This computer")}
      </h4>
      <p className="text-[11px] text-[var(--text-tertiary)]">
        {t(
          "thisComputerHelp",
          undefined,
          "Chrome profiles on the computer this app runs on. Pairing tokens stay on this computer and are never sent to the server.",
        )}
      </p>

      {identity.profiles.length === 0 ? (
        <p data-testid="browser-host-profiles-empty" className="text-xs text-[var(--text-tertiary)]">
          {t("thisComputerNoProfiles", undefined, "No Chrome profiles found on this computer.")}
        </p>
      ) : (
        identity.profiles.map((p) => <HostProfileRow key={p.profileDirectory} bridge={bridge} profile={p} />)
      )}

      <div className="space-y-1">
        <h5 className="text-xs font-medium text-[var(--text-secondary)]">{t("consentsTitle", undefined, "Allowed connections")}</h5>
        {consents.length === 0 ? (
          <p data-testid="browser-host-consents-empty" className="text-xs text-[var(--text-tertiary)]">
            {t("consentsEmpty", undefined, "No stored “Always allow”.")}
          </p>
        ) : (
          <ul className="space-y-1">
            {consents.map((c) => (
              <li
                key={c.key}
                data-testid={`browser-host-consent-${c.key}`}
                className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]"
              >
                <span className="min-w-0 truncate">
                  {c.serverOrigin} · {c.profileDirectory}
                </span>
                <button type="button" data-testid={`browser-host-consent-revoke-${c.key}`} className={BTN} onClick={() => void revoke(c.key)}>
                  {t("revoke", undefined, "Revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
    <div data-testid={`browser-host-profile-${dir}`} className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px]">
          {profile.label}
          {profile.email && <span className="ml-1 text-[11px] text-[var(--text-tertiary)]">{profile.email}</span>}
        </span>
        <span data-testid={`browser-host-installed-${dir}`} className="flex-none text-[10px] text-[var(--text-tertiary)]">
          {profile.installed ? t("installed", undefined, "Extension installed") : t("notInstalled", undefined, "Extension not installed")}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <input
          type="password"
          autoComplete="off"
          aria-label={t("tokenPlaceholder", undefined, "Paste pairing token")}
          data-testid={`browser-host-token-input-${dir}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("tokenPlaceholder", undefined, "Paste pairing token")}
          className="flex-1 min-w-0 px-2 py-1 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)]"
        />
        <button type="button" data-testid={`browser-host-token-save-${dir}`} disabled={draft.length === 0 || busy} className={BTN} onClick={() => void save()}>
          {t("saveToken", undefined, "Save token")}
        </button>
      </div>
      {failed && (
        <p role="alert" data-testid={`browser-host-token-error-${dir}`} className="text-[11px] text-[var(--text-secondary)]">
          {t("hostTokenError", undefined, "Could not save the token.")}
        </p>
      )}
    </div>
  );
}
