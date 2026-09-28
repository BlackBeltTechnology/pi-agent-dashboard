/**
 * Settings ▸ Sessions ▸ Push notifications.
 *
 * Parts, in order: availability (or "Push not enabled on this server" and no
 * controls), the device toggle (hidden with an https notice outside a secure
 * context), the iOS install-to-home-screen hint, the registered tokens (by
 * server-rendered `display` only — never the URL/endpoint) with Remove and
 * Send test, and the "Add webhook URL" form, which works without Web Push.
 * A server 400 on the form is shown inline and linked via `aria-describedby`.
 * See change: add-server-push-notifications.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { usePushSubscription } from "../../hooks/usePushSubscription.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";

interface PushTokenRow {
  tokenId: string;
  transport: string;
  display: string;
  registeredAt: number;
  lastUsedAt: number;
  consecutiveFailures: number;
}

function isIOSBrowser(): boolean {
  const standalone =
    typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone;
}

export function PushNotificationsSection() {
  const { t } = useI18n();
  const push = usePushSubscription();
  const [tokens, setTokens] = useState<PushTokenRow[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, "ok" | "failed">>({});
  const urlId = useId();
  const labelId = useId();
  const errorId = useId();
  const hintId = useId();

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/push/register`);
      if (!res.ok) return;
      const body = (await res.json()) as { tokens?: PushTokenRow[] };
      setTokens(body.tokens ?? []);
    } catch {
      /* keep the previous list */
    }
  }, []);

  useEffect(() => {
    if (push.serverEnabled) void loadTokens();
  }, [push.serverEnabled, loadTokens]);

  // Reload after this device subscribes / unsubscribes so the list tracks it.
  useEffect(() => {
    if (push.serverEnabled && push.status !== "unknown") void loadTokens();
  }, [push.serverEnabled, push.status, loadTokens]);

  const addWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await fetch(`${getApiBase()}/api/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transport: "webhook", deviceToken: url.trim(), ...(label.trim() ? { label: label.trim() } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFormError(body?.error ?? t("settings.push.addFailed", undefined, "Could not add the webhook."));
        return;
      }
      setUrl("");
      setLabel("");
      await loadTokens();
    } catch {
      setFormError(t("settings.push.addFailed", undefined, "Could not add the webhook."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tokenId: string) => {
    await fetch(`${getApiBase()}/api/push/register/${encodeURIComponent(tokenId)}`, { method: "DELETE" }).catch(() => {});
    await loadTokens();
  };

  const sendTest = async (tokenId: string) => {
    const results = await push.sendTest(tokenId).catch(() => []);
    const r = results.find((x) => x.tokenId === tokenId);
    setTestStatus((s) => ({ ...s, [tokenId]: r?.ok ? "ok" : "failed" }));
    if (r?.gone) await loadTokens();
  };

  if (push.serverEnabled === null) {
    return <p className="text-xs text-[var(--text-tertiary)]">{t("settings.push.loading", undefined, "Checking push support…")}</p>;
  }
  if (!push.serverEnabled) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        {t("settings.push.notEnabled", undefined, "Push not enabled on this server")}
      </p>
    );
  }

  const subscribed = push.status === "subscribed";

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-secondary)]">
        {t(
          "settings.push.intro",
          undefined,
          "Get notified when a session finishes a turn, waits for input or crashes while you are not looking at it.",
        )}
      </p>

      {push.secureContext ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-[var(--text-primary)]">{t("settings.push.thisDevice", undefined, "Notify this browser")}</p>
            <p id={hintId} className="text-xs text-[var(--text-tertiary)]">
              {!push.supported
                ? t("settings.push.unsupported", undefined, "This browser does not support Web Push.")
                : push.status === "denied"
                  ? t("settings.push.denied", undefined, "Notifications are blocked for this site in the browser settings.")
                  : subscribed
                    ? t("settings.push.subscribed", undefined, "This browser receives push notifications.")
                    : t("settings.push.unsubscribed", undefined, "This browser does not receive push notifications.")}
            </p>
          </div>
          {push.supported && (
            <button
              type="button"
              role="switch"
              aria-checked={subscribed}
              aria-describedby={hintId}
              aria-label={t("settings.push.toggleAria", undefined, "Push notifications on this browser")}
              disabled={push.status === "denied" || push.status === "unknown"}
              onClick={() => void (subscribed ? push.unsubscribe() : push.subscribe())}
              className={`relative shrink-0 w-10 h-5 rounded-full transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${subscribed ? "bg-blue-600" : "bg-[var(--bg-tertiary)]"}`}
            >
              <span className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${subscribed ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--severity-warning-fg)]">
          {t(
            "settings.push.insecure",
            undefined,
            "Web Push needs https or localhost. Use a webhook below (ntfy, nanoMuse) or open the dashboard through an https tunnel.",
          )}
        </p>
      )}

      {isIOSBrowser() && (
        <p className="text-xs text-[var(--text-tertiary)]">
          {t(
            "settings.push.iosHint",
            undefined,
            "On iPhone and iPad, install to home screen first (Share ▸ Add to Home Screen), then enable notifications from the installed app.",
          )}
        </p>
      )}

      <div>
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
          {t("settings.push.registered", undefined, "Registered destinations")}
        </h3>
        {tokens.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">{t("settings.push.none", undefined, "No destinations registered yet.")}</p>
        ) : (
          <ul className="space-y-1">
            {tokens.map((tok) => (
              <li key={tok.tokenId} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="text-[var(--text-primary)] break-all">{tok.display}</span>
                  <span className="ml-2 text-[var(--text-tertiary)]">
                    {tok.consecutiveFailures > 0
                      ? t("settings.push.failures", { count: tok.consecutiveFailures }, "{count} failed deliveries in a row")
                      : t("settings.push.lastUsed", { time: new Date(tok.lastUsedAt).toLocaleString() }, "last used {time}")}
                  </span>
                  {testStatus[tok.tokenId] && (
                    <span role="status" className="ml-2 text-[var(--text-secondary)]">
                      {testStatus[tok.tokenId] === "ok"
                        ? t("settings.push.testOk", undefined, "Test sent")
                        : t("settings.push.testFailed", undefined, "Test failed")}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="text-[var(--accent-primary)] hover:underline focus-ring"
                    aria-label={t("settings.push.sendTestAria", { name: tok.display }, "Send test to {name}")}
                    onClick={() => void sendTest(tok.tokenId)}
                  >
                    {t("settings.push.sendTest", undefined, "Send test")}
                  </button>
                  <button
                    type="button"
                    className="text-[var(--severity-error-fg)] hover:underline focus-ring"
                    aria-label={t("settings.push.removeAria", { name: tok.display }, "Remove {name}")}
                    onClick={() => void remove(tok.tokenId)}
                  >
                    {t("settings.push.remove", undefined, "Remove")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={addWebhook} className="space-y-2" noValidate>
        <h3 className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("settings.push.addWebhookTitle", undefined, "Add webhook URL")}
        </h3>
        <div className="flex flex-col gap-1">
          <label htmlFor={urlId} className="text-xs text-[var(--text-secondary)]">
            {t("settings.push.webhookUrl", undefined, "Webhook URL")}
          </label>
          <input
            id={urlId}
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? errorId : undefined}
            placeholder="https://ntfy.sh/my-topic"
            className="rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] focus-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={labelId} className="text-xs text-[var(--text-secondary)]">
            {t("settings.push.webhookLabel", undefined, "Label (optional)")}
          </label>
          <input
            id={labelId}
            type="text"
            maxLength={64}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] focus-ring"
          />
        </div>
        {formError && (
          <p id={errorId} className="text-xs text-[var(--severity-error-fg)]">
            {formError}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || url.trim().length === 0}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50 focus-ring"
        >
          {t("settings.push.addWebhook", undefined, "Add webhook")}
        </button>
      </form>
    </div>
  );
}
