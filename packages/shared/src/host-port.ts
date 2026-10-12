/**
 * Dependency-free host/port helpers shared by every URL builder that can
 * receive a discovered or user-supplied host.
 *
 * See change: stabilize-mdns-server-identity (D4).
 */

/** Canonical comparison key: lowercase, brackets and trailing dot stripped. */
export function normalizeHostKey(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h.replace(/\.+$/, "");
}

/** `host:port` for a URL authority; IPv6 literals are bracketed. */
export function formatHostPort(host: string, port: number): string {
  const key = normalizeHostKey(host);
  return `${key.includes(":") ? `[${key}]` : key}:${port}`;
}
