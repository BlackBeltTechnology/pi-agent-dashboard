/**
 * Push token registry — one JSON file held in memory (Decision 4).
 *
 * Loaded once at construction; every read (`list`, `get`, `matching`) is
 * served from memory, so `fanout` never touches disk. `add`/`remove` write
 * through immediately (atomic tmp+rename, mode 0600, Decision 11). `touch`
 * (lastUsedAt) is persisted at most once per 60 s. `consecutiveFailures` is
 * in-memory only. An unparseable file is quarantined to
 * `<file>.corrupt-<epoch ms>` and the registry starts empty, recording an
 * error for `/api/health.push.errors`.
 * See change: add-server-push-notifications.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { writeJsonFile } from "../persistence/json-store.js";
import type { PushToken } from "./push-transports/types.js";

const MAX_PUSH_TOKENS = 50;
const TOUCH_PERSIST_INTERVAL_MS = 60_000;
const FILE_MODE = 0o600;

interface PushTokenInput {
  deviceToken: string;
  transport: string;
  label?: string;
  userId?: string;
  sessionFilter?: string[];
}

type PushTokenAddResult =
  | { ok: true; token: PushToken; created: boolean }
  | { ok: false; reason: "capacity" };

export interface PushTokenRegistry {
  add(input: PushTokenInput): PushTokenAddResult;
  remove(id: string): boolean;
  get(id: string): PushToken | undefined;
  findByDeviceToken(deviceToken: string): PushToken | undefined;
  list(): PushToken[];
  /** Tokens whose `sessionFilter` is absent/empty or contains `sessionId`. */
  matching(sessionId: string): PushToken[];
  /** Successful delivery: bump lastUsedAt (persist ≤ 1/60 s), reset failures. */
  touch(id: string): void;
  recordFailure(id: string): void;
  consecutiveFailures(id: string): number;
  onRemove(listener: (id: string) => void): void;
  /** Load-time problems (e.g. a quarantined corrupt file). */
  readonly errors: readonly string[];
}

interface RegistryFile {
  version: 1;
  tokens: PushToken[];
}

export function createPushTokenRegistry(opts: {
  path: string;
  now?: () => number;
}): PushTokenRegistry {
  const now = opts.now ?? Date.now;
  const filePath = opts.path;
  const errors: string[] = [];
  const tokens = new Map<string, PushToken>();
  const failures = new Map<string, number>();
  const removeListeners: Array<(id: string) => void> = [];
  let lastTouchPersistAt = Number.NEGATIVE_INFINITY;

  load();

  function load(): void {
    if (!fs.existsSync(filePath)) return;
    let parsed: unknown;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      parsed = raw.trim() ? JSON.parse(raw) : { version: 1, tokens: [] };
    } catch {
      quarantine();
      return;
    }
    const list = (parsed as Partial<RegistryFile> | null)?.tokens;
    if (!Array.isArray(list)) {
      quarantine();
      return;
    }
    for (const t of list) {
      if (t && typeof t.id === "string" && typeof t.deviceToken === "string" && typeof t.transport === "string") {
        tokens.set(t.id, t);
      }
    }
  }

  function quarantine(): void {
    const target = `${filePath}.corrupt-${now()}`;
    try {
      fs.renameSync(filePath, target);
    } catch {
      /* leave it; we still start empty */
    }
    const msg = `push token registry file was unreadable; quarantined to ${target} and started empty`;
    errors.push(msg);
    console.error(`[push] ${msg}`);
  }

  function persist(): void {
    const data: RegistryFile = { version: 1, tokens: [...tokens.values()] };
    writeJsonFile(filePath, data, { mode: FILE_MODE });
  }

  function findByDeviceToken(deviceToken: string): PushToken | undefined {
    for (const t of tokens.values()) if (t.deviceToken === deviceToken) return t;
    return undefined;
  }

  return {
    errors,
    add(input) {
      const existing = findByDeviceToken(input.deviceToken);
      if (existing) {
        existing.lastUsedAt = now();
        if (input.label !== undefined) existing.label = input.label;
        if (input.sessionFilter !== undefined) existing.sessionFilter = input.sessionFilter;
        persist();
        return { ok: true, token: { ...existing }, created: false };
      }
      if (tokens.size >= MAX_PUSH_TOKENS) return { ok: false, reason: "capacity" };
      const t = now();
      const token: PushToken = {
        id: crypto.randomUUID(),
        deviceToken: input.deviceToken,
        transport: input.transport,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        ...(input.sessionFilter !== undefined ? { sessionFilter: input.sessionFilter } : {}),
        registeredAt: t,
        lastUsedAt: t,
      };
      tokens.set(token.id, token);
      persist();
      return { ok: true, token: { ...token }, created: true };
    },
    remove(id) {
      if (!tokens.delete(id)) return false;
      failures.delete(id);
      persist();
      for (const l of removeListeners) l(id);
      return true;
    },
    get(id) {
      return tokens.get(id);
    },
    findByDeviceToken,
    list() {
      return [...tokens.values()].map((t) => ({ ...t }));
    },
    matching(sessionId) {
      const out: PushToken[] = [];
      for (const t of tokens.values()) {
        if (!t.sessionFilter || t.sessionFilter.length === 0 || t.sessionFilter.includes(sessionId)) out.push(t);
      }
      return out;
    },
    touch(id) {
      const t = tokens.get(id);
      if (!t) return;
      failures.delete(id);
      const at = now();
      t.lastUsedAt = at;
      if (at - lastTouchPersistAt >= TOUCH_PERSIST_INTERVAL_MS) {
        lastTouchPersistAt = at;
        persist();
      }
    },
    recordFailure(id) {
      if (!tokens.has(id)) return;
      failures.set(id, (failures.get(id) ?? 0) + 1);
    },
    consecutiveFailures(id) {
      return failures.get(id) ?? 0;
    },
    onRemove(listener) {
      removeListeners.push(listener);
    },
  };
}
