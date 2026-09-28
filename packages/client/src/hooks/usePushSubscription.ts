/**
 * Web Push registration for THIS browser.
 *
 * Feature-detects Push API support + a secure context, fetches the VAPID
 * public key (a non-ok answer means push is not enabled on the server), and
 * reflects the current `pushManager` subscription. `subscribe()` asks for
 * notification permission, subscribes, and POSTs `/api/push/register`
 * (idempotent server-side by subscription). An existing subscription is
 * re-registered on mount so a server that lost its token file heals itself.
 * See change: add-server-push-notifications.
 */
import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";

type PushStatus = "unknown" | "unsubscribed" | "subscribed" | "denied";

export interface PushSubscriptionState {
  /** Push API + service worker available AND a secure context. */
  supported: boolean;
  /** `window.isSecureContext` — Web Push needs https or localhost. */
  secureContext: boolean;
  /** null while loading; false when the server answers non-ok (push disabled). */
  serverEnabled: boolean | null;
  status: PushStatus;
  subscribe(): Promise<void>;
  unsubscribe(): Promise<void>;
  /** POST `/api/push/test` for one token (or all); opaque `{tokenId, ok, gone?}` results. */
  sendTest(tokenId?: string): Promise<PushTestResult[]>;
}

interface PushTestResult {
  tokenId: string;
  ok: boolean;
  gone?: boolean;
}

const TOKEN_ID_KEY = "pi-dashboard.push.tokenId";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function registerSubscription(sub: PushSubscription): Promise<string | null> {
  const res = await fetch(`${getApiBase()}/api/push/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transport: "web-push", deviceToken: JSON.stringify(sub.toJSON()) }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { tokenId?: string };
  return body.tokenId ?? null;
}

export function usePushSubscription(): PushSubscriptionState {
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  const supported = detectSupport();
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [status, setStatus] = useState<PushStatus>("unknown");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/push/vapid-public-key`);
        if (cancelled) return;
        if (!res.ok) {
          setServerEnabled(false);
          return;
        }
        const body = (await res.json()) as { publicKey?: string };
        if (cancelled) return;
        setPublicKey(body.publicKey ?? null);
        setServerEnabled(true);
      } catch {
        if (!cancelled) setServerEnabled(false);
      }
    };
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supported || !serverEnabled) return;
    let cancelled = false;
    const sync = async () => {
      try {
        if (Notification.permission === "denied") {
          setStatus("denied");
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (!sub) {
          setStatus("unsubscribed");
          return;
        }
        // Only "subscribed" when the server holds the token; a rejected
        // re-register leaves the toggle off (toggling on re-registers).
        const tokenId = await registerSubscription(sub);
        if (cancelled) return;
        if (!tokenId) {
          setStatus("unsubscribed");
          return;
        }
        localStorage.setItem(TOKEN_ID_KEY, tokenId);
        setStatus("subscribed");
      } catch {
        if (!cancelled) setStatus("unsubscribed");
      }
    };
    sync().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported, serverEnabled]);

  const subscribe = useCallback(async () => {
    if (!supported || !publicKey) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "denied" : "unsubscribed");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
    const tokenId = await registerSubscription(sub).catch(() => null);
    if (!tokenId) {
      // The server never learned this subscription: do not show the toggle on,
      // and drop the browser side so a retry starts clean.
      await sub.unsubscribe().catch(() => false);
      setStatus("unsubscribed");
      return;
    }
    localStorage.setItem(TOKEN_ID_KEY, tokenId);
    setStatus("subscribed");
  }, [supported, publicKey]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    const tokenId = localStorage.getItem(TOKEN_ID_KEY);
    if (tokenId) {
      await fetch(`${getApiBase()}/api/push/register/${encodeURIComponent(tokenId)}`, { method: "DELETE" }).catch(() => {});
      localStorage.removeItem(TOKEN_ID_KEY);
    }
    await sub?.unsubscribe().catch(() => false);
    setStatus("unsubscribed");
  }, [supported]);

  const sendTest = useCallback(async (tokenId?: string): Promise<PushTestResult[]> => {
    const res = await fetch(`${getApiBase()}/api/push/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenId ? { tokenId } : {}),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: PushTestResult[] };
    return body.results ?? [];
  }, []);

  return { supported, secureContext, serverEnabled, status, subscribe, unsubscribe, sendTest };
}
