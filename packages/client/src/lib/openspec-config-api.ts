/**
 * Client fetch helper + hook for `GET /api/openspec/config`.
 *
 * Returns the user's enabled OpenSpec workflow commands so the
 * client can render only the buttons whose backing command is
 * enabled. Falls back to DEFAULT_OPENSPEC_CONFIG (full expanded
 * set) when the fetch fails or hasn't arrived yet.
 *
 * See change: redesign-session-card-and-composer (config-driven-workflow).
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_OPENSPEC_CONFIG,
  type OpenSpecConfig,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "./api-context.js";

export async function fetchOpenSpecConfig(cwd: string, signal?: AbortSignal): Promise<OpenSpecConfig> {
  const res = await fetch(
    `${getApiBase()}/api/openspec/config?cwd=${encodeURIComponent(cwd)}`,
    { signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.success) throw new Error(body?.error ?? "config fetch failed");
  return body.data as OpenSpecConfig;
}

/**
 * useOpenSpecConfig — fetches the config for the given cwd once on mount
 * and whenever `cwd` changes. Returns the last successful config or
 * DEFAULT_OPENSPEC_CONFIG until a fetch resolves.
 *
 * Cache lives in a module-scope Map keyed by cwd so navigating between
 * sessions in the same cwd is cheap.
 */
const configCache = new Map<string, OpenSpecConfig>();

export function useOpenSpecConfig(cwd: string | undefined): OpenSpecConfig {
  const [config, setConfig] = useState<OpenSpecConfig>(() =>
    cwd ? configCache.get(cwd) ?? DEFAULT_OPENSPEC_CONFIG : DEFAULT_OPENSPEC_CONFIG,
  );
  const lastCwdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!cwd) {
      setConfig(DEFAULT_OPENSPEC_CONFIG);
      return;
    }
    // Hit cache synchronously.
    const cached = configCache.get(cwd);
    if (cached && lastCwdRef.current === cwd) return;
    if (cached) setConfig(cached);
    lastCwdRef.current = cwd;

    const ac = new AbortController();
    fetchOpenSpecConfig(cwd, ac.signal)
      .then((data) => {
        configCache.set(cwd, data);
        setConfig(data);
      })
      .catch(() => {
        // Keep DEFAULT_OPENSPEC_CONFIG / last cached value on failure.
      });
    return () => ac.abort();
  }, [cwd]);

  return config;
}

/** Reset the module-scope cache. Used by tests. */
export function __resetOpenSpecConfigCache(): void {
  configCache.clear();
}
