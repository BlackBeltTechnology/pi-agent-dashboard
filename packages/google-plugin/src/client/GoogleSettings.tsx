/**
 * Settings → Google accounts (empty section until the accounts UI task lands).
 * See change: add-google-connect.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";

export function GoogleSettings() {
  const t = useT();
  return (
    <section className="flex flex-col gap-3" data-testid="google-settings" aria-labelledby="google-settings-title">
      <h3 id="google-settings-title" className="m-0 text-sm font-semibold text-[var(--text-primary)]">
        {t("title", undefined, "Google accounts")}
      </h3>
      <p className="m-0 text-xs text-[var(--text-secondary)]">
        {t("intro", undefined, "Connect Google accounts here (Gmail, Calendar, Drive and more).")}
      </p>
    </section>
  );
}
