/**
 * Per-app facts of the generic `CraftFrameHost`. The manifest claim `id` (= the
 * `craft-apps` registry id) keys the table; `maxBytes` mirrors the claim's size limit
 * (`OFFICE_SIZE_CAPS`, the same constants the claims in `package.json` use).
 * See change: edit-office-in-pane-with-craft-web (D1, D4).
 */
import { OFFICE_SIZE_CAPS } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";

export interface CraftWebApp {
  /** Claim id and `craft-apps` registry id; also the `/apps/craft-<id>/` mount and status key. */
  id: string;
  /** Display name ("WordCraft"). */
  label: string;
  /** The tab extension this app edits, lower-case with leading dot. */
  extension: string;
  /** Largest document the workspace save path accepts. */
  maxBytes: number;
}

export const CRAFT_WEB_APPS: Readonly<Record<string, CraftWebApp>> = {
  wordcraft: { id: "wordcraft", label: "WordCraft", extension: ".docx", maxBytes: OFFICE_SIZE_CAPS.docx },
  gridcraft: { id: "gridcraft", label: "GridCraft", extension: ".xlsx", maxBytes: OFFICE_SIZE_CAPS.sheet },
  deckcraft: { id: "deckcraft", label: "DeckCraft", extension: ".pptx", maxBytes: OFFICE_SIZE_CAPS.pptx },
};

/** Apps with a manifest claim (settings fallback when status is unavailable); pinned to the server table by `manifest.test.ts`. */
export const CLAIMED_WEB_APP_IDS: readonly string[] = ["wordcraft"];
