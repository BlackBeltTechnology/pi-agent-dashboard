/**
 * "Genuinely local browser" predicate (design D12a): loopback peer AND no proxy
 * forwarding header, so a same-host tunnel counts as remote. Mirrors the host rule
 * (`packages/server/src/auth/localhost-guard.ts`) and the gmail setup rule.
 * See change: add-google-connect.
 */

function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.startsWith("::ffff:") ? addr.slice(7) : addr;
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** Headers a proxy/tunnel injects; `x-forwarded-*` matched by prefix. */
function isProxyHeader(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("x-forwarded-") || n === "forwarded" || n === "via" || n === "x-real-ip";
}

export function isGenuinelyLocal(headers: Record<string, unknown>, remoteAddress: string | undefined): boolean {
  if (!isLoopbackAddress(remoteAddress)) return false;
  return !Object.keys(headers).some(isProxyHeader);
}
