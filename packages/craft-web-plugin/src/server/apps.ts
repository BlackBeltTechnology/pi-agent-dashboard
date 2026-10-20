/**
 * Server-side app table of the craft-web plugin, projected from the adapter profiles
 * (`../shared/app-profiles.ts`). Claim ids map to an APP id (a claim id is no longer always the app id);
 * status, prepare, config (`apps.<appId>`), mount (`/apps/craft-<appId>/`) and the file validators stay
 * keyed by app id. `__tests__/manifest.test.ts` keeps profiles, `package.json` claims and the registry
 * from drifting.
 *
 * See change: edit-office-in-pane-with-craft-web (D1, D3), extend-craft-web-to-all-apps (D1, D2).
 */
import { CRAFT_APP_PROFILES } from "../shared/app-profiles.js";

export interface CraftWebServerApp {
  /** `craft-apps` registry id, status/prepare/config/mount key. */
  id: string;
  /** Claim ids of this app. */
  claimIds: readonly string[];
  /** Approximate gzip download before the first prepare. */
  approxDownloadBytes: number;
}

/** Apps with a profile (= with manifest claims), keyed by app id. */
export const CRAFT_WEB_APPS: Readonly<Record<string, CraftWebServerApp>> = Object.fromEntries(
  CRAFT_APP_PROFILES.map((p) => [p.appId, { id: p.appId, claimIds: p.claims.map((c) => c.id), approxDownloadBytes: p.approxDownloadBytes }]),
);

/** Claim id → app id. */
export const CLAIM_APP: Readonly<Record<string, string>> = Object.fromEntries(CRAFT_APP_PROFILES.flatMap((p) => p.claims.map((c) => [c.id, p.appId])));

export const CLAIMED_APPS: readonly string[] = Object.keys(CRAFT_WEB_APPS);

/** `/apps/<appId>/` mount id of an app. */
export const mountId = (app: string): string => `craft-${app}`;

export const isClaimedApp = (app: unknown): app is string => typeof app === "string" && Object.hasOwn(CRAFT_WEB_APPS, app);
