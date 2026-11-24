/**
 * Settings → Gmail: a pointer notice. Account, client and setup management moved to Settings → Google accounts
 * (change: add-google-connect). `GET /api/plugins/gmail/state` answers `{ moved: true }` while Google Connect is
 * usable and `{ moved: false, googleConnect: "unavailable" }` while it is not — either way this section holds no
 * account or client forms and no Connect button. See change: add-google-connect.
 */
import { SettingsNotice, useT } from "@blackbelt-technology/dashboard-plugin-runtime";

import { useEffect, useState } from "react";

/** The dashboard route of the Google plugin's settings page. */
const GOOGLE_SETTINGS_PATH = "/settings/plugins/google";

type Moved = "usable" | "unavailable";

function openGoogleSettings(e: React.MouseEvent<HTMLAnchorElement>): void {
  // SPA navigation (wouter listens to history events); a modified click keeps the browser's own behaviour.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  window.history.pushState(null, "", GOOGLE_SETTINGS_PATH);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function GmailSettings() {
  const t = useT();
  const [moved, setMoved] = useState<Moved | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/plugins/gmail/state")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { moved?: boolean };
      })
      .then((body) => live && setMoved(body.moved === true ? "usable" : "unavailable"))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3" data-testid="gmail-settings" aria-labelledby="gmail-settings-title">
      <h3 id="gmail-settings-title" className="m-0 text-sm font-semibold text-[var(--text-primary)]">
        {t("title", undefined, "Gmail")}
      </h3>
      {error && (
        <SettingsNotice tone="error" testId="gmail-load-error">
          {error}
        </SettingsNotice>
      )}
      {moved === "usable" && (
        <SettingsNotice tone="info" testId="gmail-moved">
          {t("movedNotice", undefined, "Gmail accounts are now managed under Settings → Google accounts. Nothing to reconnect.")}{" "}
          <a
            href={GOOGLE_SETTINGS_PATH}
            data-testid="gmail-open-google"
            className="focus-ring text-[var(--accent-text)] underline"
            onClick={openGoogleSettings}
          >
            {t("movedLink", undefined, "Open Google accounts")}
          </a>
        </SettingsNotice>
      )}
      {moved === "unavailable" && (
        <SettingsNotice tone="info" testId="gmail-google-off">
          {t("googleOff", undefined, "Turn on Google accounts to manage Gmail accounts")}
        </SettingsNotice>
      )}
    </section>
  );
}
