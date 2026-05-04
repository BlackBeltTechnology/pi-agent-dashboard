/**
 * VAPID key lifecycle: generate once, persist with 0600, reuse across restarts.
 * See change: add-server-push-notifications.
 */
import { createRequire } from "node:module";
import { readJsonFile, writeJsonFile } from "../json-store.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const _require = createRequire(import.meta.url);

/** Minimal type for web-push's generateVAPIDKeys. */
interface WebPushModule {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
}

/**
 * Load existing VAPID keys from disk, or generate a new keypair and persist.
 * Keys are stored with 0600 permissions (owner read/write only).
 */
export function loadOrGenerateVapidKeys(filePath: string): VapidKeys {
  const existing = readJsonFile<VapidKeys | null>(filePath, null);
  if (existing && existing.publicKey && existing.privateKey) {
    return existing;
  }

  // Lazy-import web-push via createRequire — web-push is a CJS-only package.
  const webpush = _require("web-push") as WebPushModule;
  const keys = webpush.generateVAPIDKeys();

  const vapid: VapidKeys = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
  writeJsonFile(filePath, vapid, { mode: 0o600 });
  return vapid;
}
