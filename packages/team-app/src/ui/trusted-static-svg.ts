/**
 * `pi-static-svg` Trusted Types policy for the team app's constant icon maps
 * (change: harden-client-sinks, design D5).
 *
 * The policy input is a KEY, never markup: it looks the key up in the
 * compile-time `ICON` / `GALLERY` maps (`i18n/catalog.ts`). Keys may come from
 * data (avatar ids); the output is always a constant entry, and an unknown key
 * yields empty markup. Import is restricted to `ui/icons.tsx` by the sink guard.
 */
import { GALLERY, ICON } from "../i18n/catalog.js";

export type StaticSvgMap = "icon" | "gallery";

function lookup(key: string, map: StaticSvgMap): string {
  if (map === "gallery") return Object.hasOwn(GALLERY, key) ? GALLERY[key].svg : "";
  return Object.hasOwn(ICON, key) ? ICON[key] : "";
}

interface StaticSvgPolicy {
  createHTML(key: string, map: StaticSvgMap): TrustedHTML;
}

let policy: StaticSvgPolicy | null | undefined;

function getPolicy(): StaticSvgPolicy | null {
  if (policy === undefined) {
    const tt = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: object): StaticSvgPolicy } }).trustedTypes;
    policy = tt
      ? tt.createPolicy("pi-static-svg", { createHTML: (key: string, map: StaticSvgMap) => lookup(key, map) })
      : null;
  }
  return policy;
}

/** Constant SVG markup for `key` in `map` (trusted value where supported). */
export function trustedStaticSvg(map: StaticSvgMap, key: string): TrustedHTML | string {
  const p = getPolicy();
  return p ? p.createHTML(key, map) : lookup(key, map);
}
