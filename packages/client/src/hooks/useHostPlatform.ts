/**
 * useHostPlatform — one-shot probe of `/api/health` returning the
 * server's `platform` field (`process.platform`: "darwin" | "win32" |
 * "linux" | …).
 *
 * Used by Settings → Tools to filter a tool's install hints to the HOST
 * OS, not the browser OS. A user on an iPhone hitting a Linux dashboard
 * must see `apt`/`brew`-for-Linux commands, not iOS guidance. The server
 * value is authoritative; `navigator.userAgentData.platform` is only a
 * fallback when the probe misses.
 *
 * Returns `null` while in flight; consumers fall back to the browser
 * platform on `null`. The value cannot change without a server restart
 * (which drops the page), so the probe runs once per page lifetime and
 * caches at module scope — same pattern as `useLaunchSource`.
 *
 * See change: register-bash-and-tool-install-help.
 */
import { useEffect, useState } from "react";
import { logRejection } from "../lib/report-error.js";

/** Host platforms we render install hints for. Mirrors keyof InstallHints. */
export type HostPlatform = "darwin" | "win32" | "linux";

let cached: HostPlatform | null = null;
let inflight: Promise<HostPlatform | null> | null = null;

function normalize(p: unknown): HostPlatform | null {
  return p === "darwin" || p === "win32" || p === "linux" ? p : null;
}

/** Best-effort browser-side fallback when the health probe misses. */
export function browserPlatformFallback(): HostPlatform | null {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw = (nav.userAgentData?.platform ?? nav.platform ?? "").toLowerCase();
  if (raw.includes("win")) return "win32";
  if (raw.includes("mac")) return "darwin";
  if (raw.includes("linux")) return "linux";
  return null;
}

function probe(): Promise<HostPlatform | null> {
  // Explicit nullish check — a `Promise` is always truthy, so the bare guard was
  // correct only by accident. See change: cleanup-client-plugin-promises (D6).
  if (inflight !== null) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return null;
      const body = (await res.json()) as { platform?: string };
      cached = normalize(body.platform);
      return cached;
    } catch {
      return null;
    }
  })();
  return inflight;
}

export function useHostPlatform(): HostPlatform | null {
  const [value, setValue] = useState<HostPlatform | null>(cached);
  useEffect(() => {
    if (cached) {
      setValue(cached);
      return;
    }
    let cancelled = false;
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void probe()
      .then((v) => {
        if (!cancelled) setValue(v ?? browserPlatformFallback());
      })
      .catch(logRejection("useHostPlatform.probe"));
    return () => {
      cancelled = true;
    };
  }, []);
  return value;
}

/** Test-only: reset the module-level cache. */
export function __resetHostPlatformCacheForTests(): void {
  cached = null;
  inflight = null;
}
