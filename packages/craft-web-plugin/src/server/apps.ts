/**
 * Server-side app table of the craft-web plugin. One row per app that has a manifest
 * claim (the claim id equals the `craft-apps` registry id). `__tests__/manifest.test.ts`
 * (E1) keeps this table, the `package.json` claims and the registry from drifting.
 *
 * See change: edit-office-in-pane-with-craft-web (D1, D3).
 */

export interface CraftWebServerApp {
  /** Claim id, `craft-apps` registry id, status/prepare key. */
  id: string;
  /** Edited extension, lower-case with leading dot. */
  extension: string;
  /** Approximate gzip download before the first prepare (the spike's WordCraft 0.8.0 build: 15.8 MB wasm + ~165 KB js). */
  approxDownloadBytes: number;
}

/** Apps with a manifest claim today (WordCraft only; GridCraft/DeckCraft join after their spikes). */
export const CRAFT_WEB_APPS: Readonly<Record<string, CraftWebServerApp>> = {
  wordcraft: { id: "wordcraft", extension: ".docx", approxDownloadBytes: 16_500_000 },
};

export const CLAIMED_APPS: readonly string[] = Object.keys(CRAFT_WEB_APPS);

/** `/apps/<appId>/` mount id of an app. */
export const mountId = (app: string): string => `craft-${app}`;

export const isClaimedApp = (app: unknown): app is string => typeof app === "string" && Object.hasOwn(CRAFT_WEB_APPS, app);
