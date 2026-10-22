/**
 * Client boot sequence (change: harden-client-sinks, design D5/D8).
 *
 * Order is the contract: Trusted Types policies (named + exactly one
 * `default`) are registered, the violation reporter starts and the service
 * worker is registered through `pi-worker-url` — all BEFORE the first render.
 * Then the initial i18n catalog loads (no English flash) and `mount` renders.
 * `main.tsx` also calls `installTrustedTypes()` as its first statement; the
 * call here is idempotent.
 */
import { setLinkBlockedNoticeText } from "@blackbelt-technology/dashboard-plugin-runtime";
import { detectInitialLanguage, t as i18nT, loadCatalog } from "../i18n/i18n.js";
import { installTrustedTypes, startViolationReporter, trustedWorkerUrl } from "../security/trusted-types.js";

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  try {
    // PWA installability. The script URL comes from the pi-worker-url policy.
    void navigator.serviceWorker.register(trustedWorkerUrl("/sw.js") as string).catch(() => {});
  } catch {
    /* refused by the policy — no service worker */
  }
}

/** Register policies + reporter + service worker, load the catalog, then `mount`. */
export async function bootClient(mount: () => void): Promise<void> {
  installTrustedTypes();
  startViolationReporter();
  setLinkBlockedNoticeText(() => i18nT("nav.linkBlocked", undefined, "Link blocked: this address is not allowed to open."));
  registerServiceWorker();
  // `loadCatalog` never rejects — a failed load falls back to the English call-site text.
  await loadCatalog(detectInitialLanguage());
  mount();
}
