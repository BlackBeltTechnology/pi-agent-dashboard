/**
 * Push token registry — persistence and validation for Web Push device tokens.
 *
 * Tokens stored in `~/.pi/dashboard/push-tokens.json` with 0600 permissions.
 * Uniqueness enforced by `deviceToken.endpoint`.
 * See change: add-server-push-notifications.
 */
import crypto from "node:crypto";
import { readJsonFile, writeJsonFile } from "../json-store.js";
import type { PushToken, PushSubscriptionJSON, PushTokenMeta } from "./push-types.js";

export interface PushTokenRegistry {
  /** Register or update a token. Returns the assigned id. */
  add(token: Omit<PushToken, "id" | "registeredAt" | "lastUsedAt">): string;
  /** Remove a token by id. Returns true if it existed. */
  remove(id: string): boolean;
  /** List all tokens (full objects with keys — internal use only). */
  list(): PushToken[];
  /** Find a token by its endpoint URL. */
  findByEndpoint(endpoint: string): PushToken | undefined;
  /** Update `lastUsedAt` for a token. */
  touch(id: string): void;
  /** List public-safe metadata (no keys, truncated endpoint). */
  listMeta(): PushTokenMeta[];
}

/**
 * Validate a PushSubscriptionJSON object.
 * Throws if the endpoint is not HTTPS or keys are missing/malformed.
 */
function validateDeviceToken(dt: unknown): asserts dt is PushSubscriptionJSON {
  if (!dt || typeof dt !== "object") {
    throw new Error("deviceToken must be an object");
  }
  const d = dt as Record<string, unknown>;

  if (typeof d.endpoint !== "string" || !d.endpoint.startsWith("https://")) {
    throw new Error("deviceToken.endpoint must be an HTTPS URL");
  }

  const keys = d.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== "object") {
    throw new Error("deviceToken.keys must be an object with p256dh and auth");
  }

  if (typeof keys.p256dh !== "string" || keys.p256dh.length === 0) {
    throw new Error("deviceToken.keys.p256dh must be a non-empty base64url string");
  }
  if (typeof keys.auth !== "string" || keys.auth.length === 0) {
    throw new Error("deviceToken.keys.auth must be a non-empty base64url string");
  }
}

export function createPushTokenRegistry(opts: { path: string }): PushTokenRegistry {
  const filePath = opts.path;

  function load(): PushToken[] {
    return readJsonFile<PushToken[]>(filePath, []);
  }

  function save(tokens: PushToken[]): void {
    writeJsonFile(filePath, tokens, { mode: 0o600 });
  }

  return {
    add(token): string {
      validateDeviceToken(token.deviceToken);

      const tokens = load();
      const now = new Date().toISOString();

      // Idempotent by endpoint
      const existing = tokens.find(
        (t) => t.deviceToken.endpoint === token.deviceToken.endpoint,
      );
      if (existing) {
        existing.lastUsedAt = now;
        if (token.userId !== undefined) existing.userId = token.userId;
        save(tokens);
        return existing.id;
      }

      const id = crypto.randomUUID();
      const entry: PushToken = {
        id,
        deviceToken: token.deviceToken,
        transport: token.transport,
        ...(token.userId !== undefined ? { userId: token.userId } : {}),
        registeredAt: now,
        lastUsedAt: now,
      };
      tokens.push(entry);
      save(tokens);
      return id;
    },

    remove(id: string): boolean {
      const tokens = load();
      const idx = tokens.findIndex((t) => t.id === id);
      if (idx === -1) return false;
      tokens.splice(idx, 1);
      save(tokens);
      return true;
    },

    list(): PushToken[] {
      return load();
    },

    findByEndpoint(endpoint: string): PushToken | undefined {
      return load().find((t) => t.deviceToken.endpoint === endpoint);
    },

    touch(id: string): void {
      const tokens = load();
      const token = tokens.find((t) => t.id === id);
      if (token) {
        token.lastUsedAt = new Date().toISOString();
        save(tokens);
      }
    },

    listMeta(): PushTokenMeta[] {
      return load().map((t) => ({
        id: t.id,
        transport: t.transport,
        endpointLast4: t.deviceToken.endpoint.slice(-4),
        registeredAt: t.registeredAt,
        lastUsedAt: t.lastUsedAt,
      }));
    },
  };
}
