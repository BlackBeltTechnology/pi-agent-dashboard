/**
 * VAPID keypair for Web Push, generated once and persisted at mode 0600 so
 * existing browser subscriptions survive restarts (Decision 2). The file holds
 * the signing private key — never log or serve it; only `publicKey` leaves.
 * See change: add-server-push-notifications.
 */
import fs from "node:fs";
import webPush from "web-push";
import { writeJsonFile } from "../persistence/json-store.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function isVapidKeys(v: unknown): v is VapidKeys {
  const o = v as Partial<VapidKeys> | null;
  return !!o && typeof o.publicKey === "string" && o.publicKey.length > 0 && typeof o.privateKey === "string" && o.privateKey.length > 0;
}

export function loadOrGenerateVapidKeys(filePath: string): VapidKeys {
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (isVapidKeys(parsed)) return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    } catch {
      /* fall through: regenerate (existing subscriptions become invalid) */
    }
    console.error("[push] push-vapid.json unreadable; generating a new VAPID keypair");
  }
  const keys = webPush.generateVAPIDKeys();
  const out: VapidKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  writeJsonFile(filePath, out, { mode: 0o600 });
  return out;
}
