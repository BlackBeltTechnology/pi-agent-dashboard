/**
 * Watches the DIRECTORY holding providers.json (atomic tmp+rename swaps the
 * inode, so watching the file breaks, and macOS reports renames under
 * unreliable filenames). ANY dir event arms a debounce; after it, a hash of the
 * effective role map decides whether a pass runs (byte-different but
 * semantically-equal writes cause none). The engine never writes providers.json
 * so there is no self-trigger loop.
 *
 * See change: add-role-aware-model-refs (D7).
 */

import { createHash } from "node:crypto";
import { type FSWatcher, mkdirSync, watch } from "node:fs";

export interface RoleWatcherDeps {
  dir: string;
  debounceMs?: number;
  readRoles: () => Record<string, string>;
  onChange: () => void | Promise<void>;
  onError?: (e: unknown) => void;
}

export function hashRoles(roles: Record<string, string>): string {
  const sorted = Object.keys(roles).sort().map((k) => [k, roles[k]]);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export function startRoleWatcher(deps: RoleWatcherDeps): { close(): void; baseline(): void } {
  const debounceMs = deps.debounceMs ?? 250;
  let lastHash = hashRoles(deps.readRoles());
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const fire = () => {
    timer = undefined;
    const h = hashRoles(deps.readRoles());
    if (h === lastHash) return;
    lastHash = h;
    void Promise.resolve(deps.onChange()).catch((e) => deps.onError?.(e));
  };
  try {
    mkdirSync(deps.dir, { recursive: true });
    watcher = watch(deps.dir, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, debounceMs);
    });
    watcher.on("error", (e) => deps.onError?.(e));
  } catch (e) {
    deps.onError?.(e);
  }
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
    baseline() {
      lastHash = hashRoles(deps.readRoles());
    },
  };
}
