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
  // Strip trailing dots by scanning — a `/\.+$/` regex is polynomial on long dot runs.
  let end = h.length;
  while (end > 0 && h.charCodeAt(end - 1) === 46) end--;
  return h.slice(0, end);
}

/**
 * True when `host` is a plausible DNS name or IP literal: only `[a-z0-9_-]` labels
 * (≤ 63 chars, no leading/trailing hyphen) or a `[0-9a-f:.]` IPv6 literal. Rejects
 * URL-authority tricks (`@`, `/`, `?`, `#`, whitespace) before a host is placed in a URL.
 */
export function isValidHost(host: string): boolean {
  const h = normalizeHostKey(host);
  if (h.length === 0 || h.length > 253) return false;
  if (h.includes(":")) return h.length <= 45 && /^[0-9a-f:.]+$/.test(h);
  return h.split(".").every((l) => l.length > 0 && l.length <= 63 && /^[a-z0-9_-]+$/.test(l) && !l.startsWith("-") && !l.endsWith("-"));
}

/** `host:port` for a URL authority; IPv6 literals are bracketed. */
export function formatHostPort(host: string, port: number): string {
  const key = normalizeHostKey(host);
  return `${key.includes(":") ? `[${key}]` : key}:${port}`;
}
