/**
 * randomUuid — RFC 4122 v4 UUID that works in a non-secure browser context.
 *
 * `crypto.randomUUID` exists only in secure contexts (HTTPS / localhost); a
 * dashboard paired by LAN knock runs on plain `http://<lan-ip>` where it is
 * undefined. `crypto.getRandomValues` is available everywhere, so we build the
 * v4 UUID from it when the native method is missing. Request ids therefore stay
 * UUIDv4 as `spawn-correlation` requires.
 *
 * See change: add-lan-knock-pairing (D17).
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}
