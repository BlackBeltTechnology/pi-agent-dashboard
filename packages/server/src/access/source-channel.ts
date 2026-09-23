/**
 * The requester key for a REMOTE source (deferred planes, and held requests that
 * carry no capability). A peer rotating addresses within one allocation is one
 * requester: IPv4 keys on its /24, IPv6 on its /64, IPv4-mapped IPv6 as IPv4.
 * Without this, every rotated address is a fresh requester and the per-channel
 * share never engages (design D9, resolved during implementation).
 *
 * See change: add-access-grant-dialog.
 */
import { isIPv4, isIPv6 } from "node:net";

/** Expand an IPv6 literal (no zone) to eight hextets. */
function hextets(ip: string): string[] | null {
  const [head, tail, ...rest] = ip.split("::");
  if (rest.length > 0) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  if (fill < 0) return null;
  const all = [...left, ...Array(fill).fill("0"), ...right];
  return all.length === 8 ? all.map((h) => (Number.parseInt(h, 16) || 0).toString(16)) : null;
}

export function sourceChannel(ip: string | undefined): string {
  const raw = (ip ?? "").trim().toLowerCase().replace(/%.*$/, "");
  const mapped = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (isIPv4(mapped)) return `source:${mapped.split(".").slice(0, 3).join(".")}.0/24`;
  if (isIPv6(raw)) {
    const h = hextets(raw);
    if (h) return `source:${h.slice(0, 4).join(":")}::/64`;
  }
  return `source:${raw || "unknown"}`;
}
