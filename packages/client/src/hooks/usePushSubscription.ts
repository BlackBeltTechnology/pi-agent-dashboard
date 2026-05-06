/**
 * Push notification subscription hook.
 *
 * Manages the lifecycle of a Web Push subscription:
 *  - subscribe()  — request permission, VAPID key, subscribe, register
 *  - unsubscribe() — browser unsub + server DELETE
 *  - reconcile on mount — re-register existing subscription
 *  - sendTest() — send a test push via POST /api/push/test
 *
 * See change: add-server-push-notifications.
 */
import { useState, useCallback, useEffect, useRef } from "react";

export type PushStatus =
  | "unsupported"
  | "available"
  | "prompting"
  | "subscribing"
  | "subscribed"
  | "denied"
  | "error";

interface PushSubscriptionState {
  supported: boolean;
  status: PushStatus;
  tokenId: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  sendTest: () => Promise<boolean>;
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer.slice(outputArray.byteOffset, outputArray.byteOffset + outputArray.byteLength);
}

async function swReady(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export function usePushSubscription(): PushSubscriptionState {
  const [status, setStatus] = useState<PushStatus>("available");
  const [tokenId, setTokenId] = useState<string | null>(null);
  const mounted = useRef(true);

  // Check support on mount
  const supported: boolean =
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "serviceWorker" in navigator &&
    window.location.protocol === "https:";

  // Reconcile existing subscription on mount
  useEffect(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }

    mounted.current = true;
    const reconcile = async () => {
      try {
        const sw = await swReady();
        if (!sw || !mounted.current) return;

        const existingSub = await sw.pushManager.getSubscription();
        if (existingSub && mounted.current) {
          // Re-register with the server (idempotent)
          const resp = await fetch("/api/push/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              deviceToken: existingSub.toJSON(),
              transport: "web-push",
            }),
          });
          if (resp.ok && mounted.current) {
            const ct = resp.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const data = await resp.json();
              setTokenId(data.tokenId);
              setStatus("subscribed");
            }
          }
        }
      } catch {
        // Best-effort reconciliation — subscribe() will handle errors explicitly
      }
    };
    reconcile();

    return () => {
      mounted.current = false;
    };
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }

    try {
      setStatus("prompting");

      // 1. Request notification permission
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("denied");
        return;
      }

      setStatus("subscribing");

      // 2. Get VAPID public key from server
      const keyResp = await fetch("/api/push/vapid-public-key");
      if (!keyResp.ok) {
        if (keyResp.status === 404) {
          // Push not enabled on server — differentiate from generic error
          setStatus("available");
          return;
        }
        setStatus("error");
        return;
      }
      // Guard against non-JSON responses (e.g. index.html when route not registered)
      const ct = keyResp.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setStatus("available");
        return;
      }
      const { publicKey } = await keyResp.json();

      // 3. Subscribe via PushManager
      const sw = await swReady();
      if (!sw) {
        setStatus("error");
        return;
      }

      const applicationServerKey = urlBase64ToArrayBuffer(publicKey);
      const pushSub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // 4. Register with server
      const regResp = await fetch("/api/push/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceToken: pushSub.toJSON(),
          transport: "web-push",
        }),
      });

      if (!regResp.ok) {
        setStatus("error");
        return;
      }

      const data = await regResp.json();
      if (mounted.current) {
        setTokenId(data.tokenId);
        setStatus("subscribed");
      }
    } catch {
      if (mounted.current) setStatus("error");
    }
  }, [supported]);

  const unsubscribe = useCallback(async () => {
    try {
      // Browser-side unsub
      const sw = await swReady();
      if (sw) {
        const existingSub = await sw.pushManager.getSubscription();
        if (existingSub) {
          await existingSub.unsubscribe();
        }
      }

      // Server-side unsub
      if (tokenId) {
        await fetch(`/api/push/register/${tokenId}`, { method: "DELETE" }).catch(() => {});
      }

      if (mounted.current) {
        setTokenId(null);
        setStatus("available");
      }
    } catch {
      if (mounted.current) setStatus("error");
    }
  }, [tokenId]);

  const sendTest = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      const results = data.results || [];
      return results.some((r: { ok: boolean }) => r.ok);
    } catch {
      return false;
    }
  }, [tokenId]);

  return {
    supported,
    status: supported ? status : "unsupported",
    tokenId,
    subscribe,
    unsubscribe,
    sendTest,
  };
}
