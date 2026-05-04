/**
 * Push Notifications settings section.
 *
 * Shows push subscription status, subscribe/unsubscribe buttons,
 * list of registered devices, Send Test, and Unregister.
 * iOS hint when `iOS && !standalone`.
 *
 * See change: add-server-push-notifications.
 */
import React, { useState, useEffect, useCallback } from "react";
import { usePushSubscription } from "../hooks/usePushSubscription.js";

interface PushTokenMeta {
  id: string;
  transport: string;
  endpointLast4: string;
  registeredAt: string;
  lastUsedAt: string;
}

export function PushNotificationsSection() {
  const push = usePushSubscription();
  const [tokens, setTokens] = useState<PushTokenMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect iOS for PWA hint
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true);

  const fetchTokens = useCallback(async () => {
    try {
      const resp = await fetch("/api/push/tokens");
      if (!resp.ok) return;
      const data = await resp.json();
      setTokens(data.tokens || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (push.status === "subscribed") {
      fetchTokens();
    }
  }, [push.status, fetchTokens]);

  const handleSendTest = async () => {
    setTestResult(null);
    setError(null);
    const ok = await push.sendTest();
    setTestResult(ok);
    if (!ok) setError("Test failed — check server logs");
    setTimeout(() => {
      setTestResult(null);
      setError(null);
    }, 5000);
  };

  const handleUnregister = async (tokenId: string) => {
    try {
      setLoading(true);
      await fetch(`/api/push/register/${tokenId}`, { method: "DELETE" });
      fetchTokens();
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (!push.supported) {
    return (
      <div>
        <h3 className="text-lg font-semibold mb-3">🔔 Push Notifications</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Push notifications are not supported in this browser.
          {typeof window !== "undefined" && window.location.protocol !== "https:"
            ? " HTTPS is required for push notifications."
            : ""}
        </p>
      </div>
    );
  }

  const statusLabel: Record<string, string> = {
    available: "Not subscribed",
    prompting: "Requesting permission…",
    subscribing: "Subscribing…",
    subscribed: "Subscribed",
    denied: "Permission denied",
    error: "Error",
    unsupported: "Unsupported",
  };

  return (
    <div>
      <h3 className="text-lg font-semibold mb-3">🔔 Push Notifications</h3>

      {/* iOS PWA hint */}
      {isIOS && !isStandalone && (
        <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">
          On iOS, push notifications only work when the dashboard is installed
          to your home screen. Tap Share → Add to Home Screen first.
        </p>
      )}

      <div className="space-y-3">
        {/* Status + Actions */}
        <div className="flex items-center gap-3">
          <span
            className={`inline-block px-2 py-1 text-xs rounded ${
              push.status === "subscribed"
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                : push.status === "denied"
                  ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                  : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
            }`}
          >
            {statusLabel[push.status] || push.status}
          </span>

          {push.status !== "subscribed" && push.status !== "unsupported" && push.status !== "denied" && push.status !== "error" && (
            <button
              onClick={push.subscribe}
              disabled={
                push.status === "prompting" || push.status === "subscribing"
              }
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Enable on this device
            </button>
          )}

          {push.status === "subscribed" && (
            <>
              <button
                onClick={push.unsubscribe}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
              >
                Disable on this device
              </button>
              <button
                onClick={handleSendTest}
                disabled={testResult !== null}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {testResult === true
                  ? "✓ Sent!"
                  : testResult === false
                    ? "✗ Failed"
                    : "Send Test"}
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Registered devices */}
        {tokens.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">
              Registered devices ({tokens.length})
            </h4>
            <div className="space-y-2">
              {tokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm"
                >
                  <div>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      {token.transport}
                    </span>
                    <span className="ml-2">
                      ···{token.endpointLast4}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {new Date(token.registeredAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleUnregister(token.id)}
                    disabled={loading}
                    className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 disabled:opacity-50"
                  >
                    Unregister
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
