/**
 * Per-claim facts of the generic `CraftFrameHost`, projected from the adapter profiles
 * (`../shared/app-profiles.ts`). Keyed by manifest claim id; `id` is the APP id (status, mount,
 * prepare, config key), `claimId` the claim. `maxBytes` mirrors the claim's size limit.
 * See change: edit-office-in-pane-with-craft-web (D1, D4), extend-craft-web-to-all-apps (D1, D2).
 */
import { CRAFT_APP_PROFILES, type CraftAppProfile, type CraftClaimMode } from "../shared/app-profiles.js";

export interface CraftWebApp {
  /** `craft-apps` registry id; also the `/apps/craft-<id>/` mount and status key. */
  id: string;
  /** Manifest claim id. */
  claimId: string;
  /** Display name ("WordCraft"). */
  label: string;
  /** Claimed extensions, lower-case with leading dot. */
  extensions: readonly string[];
  mode: CraftClaimMode;
  /** Native-format extensions a save may create next to the tab's file (edit claims only). */
  siblingExtensions: readonly string[];
  /** Largest document the workspace save path accepts. */
  maxBytes: number;
  profile: CraftAppProfile;
}

export const CRAFT_WEB_APPS: Readonly<Record<string, CraftWebApp>> = Object.fromEntries(
  CRAFT_APP_PROFILES.flatMap((p) =>
    p.claims.map((c) => [
      c.id,
      {
        id: p.appId,
        claimId: c.id,
        label: p.label,
        extensions: c.extensions,
        mode: c.mode,
        siblingExtensions: c.siblingExtensions ?? [],
        maxBytes: c.maxBytes,
        profile: p,
      },
    ]),
  ),
);

/** Apps with manifest claims, profile order (settings fallback when status is unavailable). */
export const CLAIMED_WEB_APP_IDS: readonly string[] = CRAFT_APP_PROFILES.map((p) => p.appId);
