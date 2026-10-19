/**
 * Route-level validation of a `PUT /api/config` write that touches the `tls`
 * block, `port`, `piPort` or `modelProxy.secondPort` (design D7). Runs BEFORE
 * `writeConfigPartial`; answers a message (→ HTTP 400) or `null`.
 *
 * Pure: the stored config and env are arguments so the same check is unit
 * tested against the real function the route calls. Other runtime writers
 * bypass route validation (pre-existing pattern); reconcile re-validates and
 * reports `invalid-source` / `bindError`, so a bypass degrades to a reported
 * error, never a crash.
 *
 * See change: add-tailscale-cert-tls.
 */
import net from "node:net";
import {
  DEFAULT_TLS_PORT,
  resolveDashboardPorts,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { validateTlsSources } from "./source-registry.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** True when the write could change the port set or the tls block. */
export function touchesTlsOrPorts(partial: Json): boolean {
  return (
    partial.tls !== undefined ||
    partial.port !== undefined ||
    partial.piPort !== undefined ||
    (isObj(partial.modelProxy) && partial.modelProxy.secondPort !== undefined)
  );
}

function validTlsHost(host: unknown): boolean {
  if (typeof host !== "string") return false;
  const h = host.trim();
  return h === "localhost" || net.isIP(h) !== 0;
}

/** Field-level checks of a `tls` patch (the keys the caller sent). */
function validateTlsPatch(patch: unknown): string | null {
  if (!isObj(patch)) return "tls must be an object";
  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") return "tls.enabled must be a boolean";
  const p = patch.port;
  if (p !== undefined && (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > 65535)) {
    return "tls.port must be an integer between 1 and 65535";
  }
  if (patch.host !== undefined && !validTlsHost(patch.host)) return "tls.host must be an IP address or localhost";
  return patch.sources === undefined ? null : validateTlsSources(patch.sources);
}

/**
 * Uniqueness among the EFFECTIVE listener ports of the MERGED config, on every
 * write that touches any of them — a later change of `port` cannot silently
 * collide with a stored `tls.port`.
 */
function validateTlsPortUniqueness(
  partial: Json,
  stored: Json,
  mergedTls: Json,
  env: Record<string, string | undefined>,
): string | null {
  const mergedPort = typeof partial.port === "number" ? partial.port : (stored.port as number | undefined);
  const mergedPiPort = typeof partial.piPort === "number" ? partial.piPort : (stored.piPort as number | undefined);
  const { port, piPort } = resolveDashboardPorts(env, { port: mergedPort, piPort: mergedPiPort });
  const storedProxy = isObj(stored.modelProxy) ? stored.modelProxy : {};
  const patchProxy = isObj(partial.modelProxy) ? partial.modelProxy : {};
  const secondPort = (patchProxy.secondPort ?? storedProxy.secondPort) as number | undefined;
  const tlsPort = typeof mergedTls.port === "number" ? mergedTls.port : DEFAULT_TLS_PORT;
  if (tlsPort === port) return `tls.port ${tlsPort} is already used by port`;
  if (tlsPort === piPort) return `tls.port ${tlsPort} is already used by piPort`;
  if (typeof secondPort === "number" && tlsPort === secondPort) {
    return `tls.port ${tlsPort} is already used by modelProxy.secondPort`;
  }
  return null;
}

export function validateTlsConfigWrite(
  partial: Json,
  stored: Json,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!touchesTlsOrPorts(partial)) return null;
  const patch = partial.tls;
  if (patch !== undefined) {
    const err = validateTlsPatch(patch);
    if (err) return err;
  }
  const storedTls = isObj(stored.tls) ? stored.tls : null;
  const mergedTls = isObj(patch) ? { ...(storedTls ?? {}), ...patch } : storedTls;
  return mergedTls ? validateTlsPortUniqueness(partial, stored, mergedTls, env) : null;
}
