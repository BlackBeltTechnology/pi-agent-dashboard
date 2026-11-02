/**
 * Plugin host services that verify a paired-device bearer. They are consumed by plugins that receive the
 * request only sometimes (the MCP plugin passes none), so the request is OPTIONAL: absent means a
 * non-proven channel and the registry records the bearer as exposed (fail closed).
 *
 * See change: prove-vault-bridge-tls (D4).
 */
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { bearerChannelOf } from "../auth/proven-tls.js";
import type { PairedDeviceRegistry } from "./paired-devices.js";

type ChannelRequest = Parameters<typeof bearerChannelOf>[0];

export interface DeviceTokenServices {
  /** Device id for a valid bearer, or null. */
  verifyDeviceToken(token: string, req?: ChannelRequest): string | null;
  /** `{id, tier}` for a valid bearer, or null. */
  verifyDeviceTokenTier(token: string, req?: ChannelRequest): { id: string; tier: Tier } | null;
}

export function createDeviceTokenServices(registry: Pick<PairedDeviceRegistry, "verify">): DeviceTokenServices {
  return {
    verifyDeviceToken: (token, req) => registry.verify(token, bearerChannelOf(req))?.id ?? null,
    verifyDeviceTokenTier: (token, req) => registry.verify(token, bearerChannelOf(req)),
  };
}
