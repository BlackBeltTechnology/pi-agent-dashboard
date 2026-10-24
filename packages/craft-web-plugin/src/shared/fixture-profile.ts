/**
 * Profile of FakeCraft, the test double of live agent control (add-craft-live-control D8): a static page-API
 * app under `src/server/fixtures/fakecraft/`. It is NOT in `CRAFT_APP_PROFILES` (it has no `craft-apps`
 * registry entry, no download, no drift rows): the server registers its mount and status only when
 * `PI_DASHBOARD_FIXTURE_PLUGINS=1`, and without that the client's gate says "not verified" for it.
 *
 * See change: add-craft-live-control (D8, tasks 1.2, 1.3).
 */
import type { CraftAppProfile } from "./app-profiles.js";

export const FAKECRAFT_APP_ID = "fakecraft";
export const FAKECRAFT_VERSION = "1.0.0";

export const FAKECRAFT_PROFILE: CraftAppProfile = {
  appId: FAKECRAFT_APP_ID,
  label: "FakeCraft",
  ready: { kind: "trunk" },
  openedFallbackMs: 1000,
  cleanOnAckedSave: true,
  saveName: "stem",
  latestChannel: false,
  minShimVersion: 3,
  approxDownloadBytes: 8_000,
  control: {
    kind: "page-api",
    global: "fakecraft",
    verifiedVersion: FAKECRAFT_VERSION,
    allowedCommands: ["ping", "echo", "sleep", "oversize", "malformed", "save", "export", "saveDialog", "setText"],
    readOnlyCommands: ["ping"],
    saveCommands: ["save", "export", "saveDialog"],
    saveParamNames: ["path"],
  },
  claims: [{ id: "fakecraft", extensions: [".fakecraft"], mode: "edit", maxBytes: 1024 * 1024 }],
};
