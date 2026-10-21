/**
 * Browser-originated `/live/` requests need a capability.
 *
 * A sandboxed preview frame has an opaque origin: its requests carry
 * `Origin: null` and `Sec-Fetch-*` metadata. Without this rule a genuinely
 * local operator's opaque frame would reach any registered port target with no
 * capability at all (loopback peer, no forwarding header ⇒ "genuinely local").
 * A request (HTTP or WS upgrade) carrying either marker must therefore present
 * a valid capability; non-browser local callers (`curl`, `fastify.inject`) keep
 * today's admission for port targets.
 *
 * See change: improve-canvas-html-and-url-ux (design D10).
 */

/** True when the headers mark the request as browser-originated (opaque origin or fetch metadata). */
export function isBrowserOriginated(headers: Record<string, unknown>): boolean {
  if (headers.origin === "null") return true;
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith("sec-fetch-")) return true;
  }
  return false;
}
