/**
 * Client navigation chokepoints (change: harden-client-sinks, design D3).
 *
 * `SafeLink` and `openExternalUrl` are the plugin-runtime SDK helpers
 * (`dashboard-plugin-runtime/src/safe-navigation.tsx`) re-exported verbatim,
 * so the shell and plugins share one implementation. `useSafeNavigation`
 * layers the shell's routing on the SDK hook: internal targets go through
 * `useTrackedNavigate` (nav stack stays correct) and loopback targets open in
 * the live-server split viewer when a split workspace is present.
 */
import {
  type SafeNavigation,
  useSafeNavigation as useSdkSafeNavigation,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { useCallback } from "react";
import { useOptionalSplitWorkspace } from "../../components/split/SplitWorkspaceContext.js";
import { useTrackedNavigate } from "./useTrackedNavigate.js";

export { assignLocation, openExternalUrl, SafeLink } from "@blackbelt-technology/dashboard-plugin-runtime";

export function useSafeNavigation(): SafeNavigation {
  const navigateInternal = useTrackedNavigate();
  const split = useOptionalSplitWorkspace();
  const openLoopback = useCallback(
    (url: string) => {
      if (!split) return false;
      split.openLiveTarget(url);
      return true;
    },
    [split],
  );
  return useSdkSafeNavigation({ navigateInternal, openLoopback });
}
