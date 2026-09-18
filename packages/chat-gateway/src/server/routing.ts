/**
 * chat-gateway binding persistence + spawn correlation.
 *
 * `createBindingStore` keeps sticky channel→session bindings on disk (the CALLER
 * supplies the path — typically `~/.pi/dashboard/chat-gateway/bindings.json`).
 * Writes are atomic (temp file + rename), the parent dir is 0700 and the file
 * 0600 because it records who bound what.
 *
 * `createSpawnCorrelator` is the C2 mechanism: a spawn is correlated by a
 * caller-supplied token, NEVER by cwd+recency, so two concurrent same-cwd spawns
 * cannot cross-bind.
 *
 * See change: add-chat-gateway.
 */

import fs from "node:fs";
import path from "node:path";

import { type Binding, bindingKey } from "../shared/types.js";

export interface BindingStoreDeps {
  filePath: string;
  now?: () => number;
}

export interface BindingStore {
  load(): void;
  get(key: string): Binding | undefined;
  set(binding: Binding): void;
  remove(key: string): void;
  all(): Binding[];
  persist(): void;
}

export function createBindingStore(deps: BindingStoreDeps): BindingStore {
  const bindings = new Map<string, Binding>();

  function load(): void {
    bindings.clear();
    let raw: string;
    try {
      raw = fs.readFileSync(deps.filePath, "utf8");
    } catch {
      return; // missing file -> empty store
    }
    try {
      const parsed = JSON.parse(raw);
      const list: unknown = Array.isArray(parsed) ? parsed : parsed?.bindings;
      if (!Array.isArray(list)) return; // corrupt shape -> empty store
      for (const entry of list as Binding[]) {
        if (!entry || typeof entry.channelId !== "string" || typeof entry.sessionId !== "string") {
          continue;
        }
        bindings.set(bindingKey(entry), entry);
      }
    } catch {
      // corrupt JSON -> empty store, never throws
    }
  }

  function persist(): void {
    const dir = path.dirname(deps.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // mkdirSync applies the mode only when it CREATES the dir; tighten a
    // pre-existing dir so the state (who bound what) is never world-readable.
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // best effort — a non-POSIX filesystem ignores mode
    }
    const tmp = path.join(dir, `.${path.basename(deps.filePath)}.${process.pid}.tmp`);
    const payload = `${JSON.stringify({ bindings: [...bindings.values()] }, null, 2)}\n`;
    fs.writeFileSync(tmp, payload, { mode: 0o600 });
    fs.renameSync(tmp, deps.filePath);
    fs.chmodSync(deps.filePath, 0o600);
  }

  return {
    load,
    persist,
    get: (key) => bindings.get(key),
    set(binding) {
      bindings.set(bindingKey(binding), binding);
      persist();
    },
    remove(key) {
      bindings.delete(key);
      persist();
    },
    all: () => [...bindings.values()],
  };
}

export interface SpawnCorrelator {
  /** Register a pending spawn keyed by a caller-supplied correlation token. */
  expect(
    token: string,
    meta: {
      channelKey: string;
      /** Binding identity to persist on resolution (threadId preserved). */
      channelId: string;
      threadId?: string;
      /** Whether the originating channel is a DM (for L4 re-authorization). */
      isDM: boolean;
      cwd: string;
      by: string;
    },
  ): void;
  /** Resolve a registered token to a sessionId; consumes the entry. Returns false when unknown. */
  resolve(
    token: string,
    sessionId: string,
  ):
    | { channelKey: string; channelId: string; threadId?: string; isDM: boolean; cwd: string; by: string }
    | false;
  /** Drop a pending spawn that failed (spawn returned 500). */
  reject(token: string): void;
  pending(): string[];
}

export function createSpawnCorrelator(): SpawnCorrelator {
  const waiting = new Map<
    string,
    { channelKey: string; channelId: string; threadId?: string; isDM: boolean; cwd: string; by: string }
  >();
  return {
    expect(token, meta) {
      waiting.set(token, meta);
    },
    resolve(token, _sessionId) {
      const meta = waiting.get(token);
      // Unknown token -> false. The caller must NOT fall back to cwd matching.
      if (!meta) return false;
      waiting.delete(token);
      return meta;
    },
    reject(token) {
      waiting.delete(token);
    },
    pending: () => [...waiting.keys()],
  };
}
