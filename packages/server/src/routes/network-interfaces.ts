/**
 * Build the `/api/network-interfaces` payload.
 *
 * Extracted from the route so the enumeration failure mode (#X4) is testable
 * without standing a server up: `os.networkInterfaces()` can throw (sandboxed
 * or permission-restricted hosts), and that must surface as an error response
 * rather than an unhandled throw.
 *
 * ONE ENTRY PER ADDRESS, deliberately. The endpoint has two consumers — the
 * trusted-networks dropdown wants one row per offer, but the listen-interface
 * picker renders one option per address and keys on it. Deduplicating here
 * would make a real bind address unselectable, so the dropdown dedupes at
 * render time instead (Decision 12).
 *
 * See change: warn-unreachable-trusted-networks.
 */
import type os from "node:os";
import {
  deriveInterfaceSuggestions,
  interfaceLabel,
  netmaskBits,
  networkAddressOf,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import type { NetworkInterface } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

type Enumerate = () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;

export function buildNetworkInterfaceList(
  enumerate: Enumerate,
): { success: true; data: NetworkInterface[] } | { success: false; error: string } {
  // The whole build is isolated, not just `enumerate()`: an exotic platform can
  // also yield an entry with a missing/odd `netmask`, and that would throw
  // during DERIVATION — the same unhandled-route outcome, one line later.
  try {
    const interfaces = enumerate();
    const data: NetworkInterface[] = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const info of addrs) {
        if (info.internal || info.family !== "IPv4") continue;
        const { pointToPoint, suggestions } = deriveInterfaceSuggestions(info);
        data.push({
          name,
          address: info.address,
          netmask: info.netmask,
          cidr: `${networkAddressOf(info.address, info.netmask)}/${netmaskBits(info.netmask)}`,
          label: interfaceLabel(name, info.address),
          pointToPoint,
          suggestions,
        });
      }
    }
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
