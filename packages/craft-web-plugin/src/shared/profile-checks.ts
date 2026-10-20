/**
 * Structural rules of the adapter profiles (design D2), as a pure function so the drift test can run it
 * on the shipped table AND on synthetic rows (test-plan #E2, #E3). Every message names the app.
 * See change: extend-craft-web-to-all-apps.
 */
import { HANDLER_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import type { CraftAppProfile } from "./app-profiles.js";

export const OPENED_FALLBACK_MIN_MS = 1000;
export const OPENED_FALLBACK_MAX_MS = 15_000;

const EXT_RE = /^\.[a-z0-9][a-z0-9.-]{0,15}$/;

function oneProfile(p: CraftAppProfile): string[] {
  const errs: string[] = [];
  const at = (m: string) => errs.push(`${p.appId}: ${m}`);
  if (p.title) {
    if (!p.title.pattern.startsWith("^") || !p.title.pattern.endsWith("$")) at(`title pattern must be anchored (^…$): ${p.title.pattern}`);
    try {
      new RegExp(p.title.pattern);
    } catch {
      at(`title pattern is not a valid regex: ${p.title.pattern}`);
    }
    if (p.openedFallbackMs !== undefined) at("openedFallbackMs is set although the app reports a title");
  } else if (p.openedFallbackMs === undefined) {
    at("openedFallbackMs is required when the app reports no title");
  } else if (!Number.isInteger(p.openedFallbackMs) || p.openedFallbackMs < OPENED_FALLBACK_MIN_MS || p.openedFallbackMs > OPENED_FALLBACK_MAX_MS) {
    at(`openedFallbackMs ${p.openedFallbackMs} is outside ${OPENED_FALLBACK_MIN_MS}..${OPENED_FALLBACK_MAX_MS}`);
  }
  if (!Number.isInteger(p.minShimVersion) || p.minShimVersion < 1) at(`minShimVersion ${p.minShimVersion} must be a positive integer`);
  if (p.claims.length === 0) at("has no claims");
  for (const c of p.claims) {
    if (c.maxBytes > HANDLER_MAX_BYTES) at(`claim ${c.id} maxBytes ${c.maxBytes} exceeds HANDLER_MAX_BYTES`);
    for (const e of [...c.extensions, ...(c.siblingExtensions ?? [])]) if (!EXT_RE.test(e)) at(`claim ${c.id} extension "${e}" is not lower-case with a leading dot`);
    if (c.siblingExtensions?.length) {
      if (c.mode !== "edit") at(`claim ${c.id} declares siblingExtensions on a ${c.mode} claim`);
      for (const s of c.siblingExtensions) if (c.extensions.includes(s)) at(`claim ${c.id} lists ${s} in both extensions and siblingExtensions`);
    }
  }
  return errs;
}

/**
 * All rule violations of a profile table: per-profile rules plus one craft mode per extension
 * (no extension in two claims' `extensions`, nor in one claim's `extensions` and another's `siblingExtensions`).
 */
export function profileErrors(profiles: readonly CraftAppProfile[]): string[] {
  const errs = profiles.flatMap(oneProfile);
  const owner = new Map<string, string>();
  for (const p of profiles)
    for (const c of p.claims)
      for (const e of c.extensions) {
        const prev = owner.get(e);
        if (prev) errs.push(`${p.appId}: ${e} of claim ${c.id} is already claimed by ${prev}`);
        else owner.set(e, c.id);
      }
  for (const p of profiles)
    for (const c of p.claims)
      for (const s of c.siblingExtensions ?? []) {
        const o = owner.get(s);
        if (o && o !== c.id && !p.claims.some((own) => own.id === o)) errs.push(`${p.appId}: sibling ${s} of claim ${c.id} is claimed by another app's ${o}`);
      }
  const ids = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.appId)) errs.push(`${p.appId}: duplicate profile`);
    ids.add(p.appId);
  }
  return errs;
}
