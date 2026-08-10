import type { InstalledPackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";
import { logRejection } from "../lib/report-error.js";

export function useInstalledPackages(scope: "global" | "local", cwd?: string) {
  const [packages, setPackages] = useState<InstalledPackage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchInstalled = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope });
      if (cwd) params.set("cwd", cwd);
      const res = await fetch(`${getApiBase()}/api/packages/installed?${params}`);
      const body = await res.json();
      if (!mountedRef.current) return;
      if (body.success) {
        setPackages(body.data);
      } else {
        setError(body.error ?? t("packages.installedFetchFailed", undefined, "Failed to fetch installed packages"));
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err.message ?? t("common.networkError", undefined, "Network error"));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [scope, cwd]);

  useEffect(() => {
    mountedRef.current = true;
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void fetchInstalled().catch(logRejection("useInstalledPackages.mount"));
    return () => { mountedRef.current = false; };
  }, [fetchInstalled]);

  // Auto-refresh when any package operation completes successfully
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "package_operation_complete" && msg.success) {
        void fetchInstalled().catch(logRejection("useInstalledPackages.refresh"));
      }
    };
    window.addEventListener("pi-package-event", handler);
    return () => window.removeEventListener("pi-package-event", handler);
  }, [fetchInstalled]);

  return { packages, isLoading, error, refresh: fetchInstalled };
}
