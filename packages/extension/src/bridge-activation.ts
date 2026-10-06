/**
 * Bridge activation gate. Decides once per factory invocation, BEFORE any
 * registration, whether the bridge runs in this pi process.
 *
 * Precedence: `PI_DASHBOARD_BRIDGE` env > `bridge.enabled` config > on.
 * A recognised env value never touches the config file. Any failure while
 * resolving fails OPEN (bridge activates) and emits no output — the opt-out
 * must never be able to break the dashboard through an error.
 *
 * See change: add-bridge-env-opt-out.
 */
import {
  type BridgeActivationConfig,
  bridgeEnvOverride,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";

export function shouldActivateBridge(
  env: Record<string, string | undefined>,
  readConfig: () => BridgeActivationConfig,
): boolean {
  try {
    return bridgeEnvOverride(env) ?? readConfig().enabled;
  } catch {
    return true;
  }
}
