/**
 * Folder command list for a composer with no live bridge behind it.
 *
 * One request per `cwd` change (module-cached for `CACHE_TTL_MS`, in-flight
 * deduped); any failure — including a 404 from an old server — yields an empty
 * list. Pass `undefined` to stay idle (no request).
 *
 * See change: redesign-directory-home-split.
 */
import { useEffect, useState } from "react";
import {
  EMPTY_FOLDER_COMMANDS,
  type FolderCommandsResult,
  fetchFolderCommands,
} from "../lib/api/folder-commands-api.js";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: FolderCommandsResult }>();
const inflight = new Map<string, Promise<FolderCommandsResult>>();

/** Test seam: drop the module cache. */
export function resetFolderCommandsCache(): void {
  cache.clear();
  inflight.clear();
}

function load(cwd: string): Promise<FolderCommandsResult> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
  const pending = inflight.get(cwd);
  if (pending) return pending;
  const p = fetchFolderCommands(cwd)
    .then((value) => {
      cache.set(cwd, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(cwd));
  inflight.set(cwd, p);
  return p;
}

export function useFolderCommands(cwd: string | undefined): FolderCommandsResult {
  const [state, setState] = useState<{ cwd: string; value: FolderCommandsResult } | null>(() => {
    const hit = cwd ? cache.get(cwd) : undefined;
    return cwd && hit ? { cwd, value: hit.value } : null;
  });

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    void load(cwd).then((value) => {
      if (!cancelled) setState({ cwd, value });
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // A result for a different cwd is never shown for this one.
  return state && cwd && state.cwd === cwd ? state.value : EMPTY_FOLDER_COMMANDS;
}
