/**
 * Per-app adapter profiles of the craft-web plugin (design D2): ONE declarative row per ArtCraft web
 * app, the single source of truth for the server claim table (`server/apps.ts`), the client claim table
 * (`client/craft-apps-table.ts`), the post-install profile emitter and the drift test
 * (`__tests__/manifest.test.ts`). Pure data + types: imported by server (node) and client (browser).
 *
 * Claim ids map to one app; status, prepare, config (`apps.<appId>`), mount (`/apps/craft-<appId>/`) and
 * settings stay keyed by APP id. An app without a profile gets no claim.
 *
 * See change: extend-craft-web-to-all-apps (D1, D2, D4, D8).
 */
import { HANDLER_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/file-handler.js";
import { OFFICE_SIZE_CAPS } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";

/** How the post-install hook makes the app's loader dispatch `TrunkApplicationStarted` (D3). */
export type CraftReadyHook =
  | { kind: "trunk" }
  /** Dispatch right after the statement assigning `window.<global>.readyMs = …`. */
  | { kind: "load-ready-ms"; global: string }
  /** Dispatch right after the (single) statement calling `<call>(`. */
  | { kind: "after-start-call"; call: string };

/** Mode of a claim: `edit` saves back through core; `preview` is view-only (saves go to the device). */
export type CraftClaimMode = "edit" | "preview";

export interface CraftClaimProfile {
  /** Manifest claim id (`craft-web/<id>` mode key). */
  id: string;
  /** Claimed extensions, lower-case with leading dot. */
  extensions: readonly string[];
  mode: CraftClaimMode;
  /** Edit claims only: native-format extensions a save may create next to the tab's file (D6). */
  siblingExtensions?: readonly string[];
  /** Largest document the workspace save path accepts for this claim. */
  maxBytes: number;
}

/** Why a `latestChannel:false` app's version is fixed (settings hint, D8/D11). */
export type FixedChannelReason = "unverified-latest" | "latest-fails-to-start";

export interface CraftAppProfile {
  /** `craft-apps` registry id; status/prepare/config/mount key. */
  appId: string;
  /** Display name ("WordCraft"). */
  label: string;
  ready: CraftReadyHook;
  /**
   * The app's viewport-title signal. `pattern`: anchored regex source, capture 1 = document name.
   * `dirtyMarker`: text marking unsaved state, stripped from the name. Absent = the app reports no title.
   */
  title?: { pattern: string; dirtyMarker?: string };
  /** No-title apps only: post `opened{confirmed:false}` this long after the synthetic drop (1000..15000). */
  openedFallbackMs?: number;
  /** An acknowledged own-file save with no input since clears dirty (the app does not clear it). */
  cleanOnAckedSave: boolean;
  /** `inner-title`: the app names saves after a document title inside the file (SoundCraft session). */
  saveName: "stem" | "inner-title";
  /** URL query flags only (e.g. `nosw`); never frame permissions. */
  frameParams?: readonly string[];
  /** Wrap `new Worker(httpUrl)` in a `blob:` bootstrap (D5). */
  workerTrampoline?: boolean;
  /** `false` = the version channel is fixed to the verified registry `webVersion` (D8). */
  latestChannel: boolean;
  /** Settings hint for a fixed channel. */
  fixedReason?: FixedChannelReason;
  /** Oldest shim whose prepared build still loads (older → `shim-outdated`). */
  minShimVersion: number;
  /** Approximate gzip download before the first prepare. */
  approxDownloadBytes: number;
  claims: readonly CraftClaimProfile[];
}

/** First sentence of the first-overwrite notice of every claim of a profile without `title` (D4). */
export const unconfirmedOpenSentence = (label: string): string => `${label} does not report which file it opened.`;

/** Full check line that leads such a notice. */
export const unconfirmedOpenCheck = (label: string): string =>
  `${unconfirmedOpenSentence(label)} Check that it shows this file before overwriting.`;

/** Size cap of a claimed extension (D2 / spec): Office caps, SVG 16 MiB, else the core handler ceiling. */
export function capForExtension(ext: string): number {
  switch (ext) {
    case ".docx":
    case ".odt":
    case ".rtf":
      return OFFICE_SIZE_CAPS.docx;
    case ".xlsx":
      return OFFICE_SIZE_CAPS.sheet;
    case ".pptx":
      return OFFICE_SIZE_CAPS.pptx;
    case ".svg":
      return SVG_MAX_BYTES;
    default:
      return HANDLER_MAX_BYTES;
  }
}

export const SVG_MAX_BYTES = 16 * 1024 * 1024;

/** Claim cap: the smallest cap over its extensions (a claim carries ONE `maxBytes`). */
const capFor = (extensions: readonly string[]): number => Math.min(...extensions.map(capForExtension));

const claim = (id: string, extensions: readonly string[], extra: Partial<CraftClaimProfile> = {}): CraftClaimProfile => ({
  id,
  extensions,
  mode: "edit",
  maxBytes: capFor(extensions),
  ...extra,
});

export const CRAFT_APP_PROFILES: readonly CraftAppProfile[] = [
  {
    appId: "wordcraft",
    label: "WordCraft",
    ready: { kind: "trunk" },
    title: { pattern: "^(.*?)(?: •)? [-–—] WordCraft$", dirtyMarker: "•" },
    cleanOnAckedSave: false,
    saveName: "stem",
    latestChannel: true,
    minShimVersion: 1,
    approxDownloadBytes: 16_500_000,
    claims: [claim("wordcraft", [".docx"])],
  },
  // ---- Wave 1: edit in place (D1 type A). New apps: channel fixed until a scheduled e2e covers latest (D8).
  {
    appId: "gridcraft",
    label: "GridCraft",
    ready: { kind: "trunk" },
    // `name — Edited` stays after a picker save (spike), so an acknowledged own save clears dirty.
    title: { pattern: "^(.*?)(?: — Edited)?$", dirtyMarker: "— Edited" },
    cleanOnAckedSave: true,
    saveName: "stem",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 7_100_000,
    claims: [claim("gridcraft", [".xlsx"])],
  },
  {
    appId: "pdfcraft",
    label: "PdfCraft",
    ready: { kind: "trunk" },
    openedFallbackMs: 3000,
    cleanOnAckedSave: true,
    saveName: "stem",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 14_500_000,
    claims: [claim("pdfcraft", [".pdf"])],
  },
  {
    appId: "cadcraft",
    label: "CADCraft",
    ready: { kind: "trunk" },
    openedFallbackMs: 3000,
    cleanOnAckedSave: true,
    saveName: "stem",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 8_500_000,
    claims: [claim("cadcraft", [".dxf"])],
  },
  {
    appId: "designcraft",
    label: "DesignCraft",
    ready: { kind: "trunk" },
    openedFallbackMs: 3000,
    cleanOnAckedSave: true,
    saveName: "stem",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 19_200_000,
    claims: [claim("designcraft", [".designcraft"])],
  },
  {
    appId: "soundcraft",
    label: "SoundCraft",
    ready: { kind: "trunk" },
    openedFallbackMs: 4000,
    cleanOnAckedSave: true,
    // Saves are named after the session inside the file ("Midnight Groove.scraftz"), not the tab's file (D10).
    saveName: "inner-title",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 5_900_000,
    claims: [claim("soundcraft", [".scraftz"])],
  },
  // ---- Wave 2: saves its native format (D1 type B) — foreign-format claims declare the native sibling.
  {
    appId: "photocraft",
    label: "PhotoCraft",
    ready: { kind: "trunk" },
    title: { pattern: "^(.*) [-–—] PhotoCraft$" },
    cleanOnAckedSave: true,
    saveName: "stem",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 11_400_000,
    claims: [claim("photocraft", [".psd"]), claim("photocraft-raster", [".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"], { siblingExtensions: [".psd"] })],
  },
  {
    appId: "vectorcraft",
    label: "VectorCraft",
    ready: { kind: "trunk" },
    title: { pattern: "^(.*) [-–—] VectorCraft$" },
    cleanOnAckedSave: true,
    saveName: "stem",
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 23_500_000,
    claims: [claim("vectorcraft", [".svg"], { siblingExtensions: [".vectorcraft"] })],
  },
  {
    appId: "deckcraft",
    label: "DeckCraft",
    ready: { kind: "trunk" },
    openedFallbackMs: 3000,
    cleanOnAckedSave: true,
    saveName: "stem",
    // Pinned to 0.7.0: the 0.8.0 web build panics on start (`std::process::id`), unsandboxed too.
    latestChannel: false,
    fixedReason: "latest-fails-to-start",
    minShimVersion: 2,
    approxDownloadBytes: 9_400_000,
    claims: [claim("deckcraft", [".pptx"], { siblingExtensions: [".deckcraft"] }), claim("deckcraft-native", [".deckcraft"])],
  },
  // ---- Wave 3: view only (D1 type C). Custom loader: `start(font)` is the ready hook point.
  {
    appId: "lightcraft",
    label: "LightCraft",
    ready: { kind: "after-start-call", call: "start" },
    // The static "LightCraft" title is not a document title.
    openedFallbackMs: 5000,
    cleanOnAckedSave: false,
    saveName: "stem",
    workerTrampoline: true,
    latestChannel: false,
    fixedReason: "unverified-latest",
    minShimVersion: 2,
    approxDownloadBytes: 22_400_000,
    claims: [claim("lightcraft", [".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2"], { mode: "preview" })],
  },
];

const BY_APP = new Map(CRAFT_APP_PROFILES.map((p) => [p.appId, p]));
const BY_CLAIM = new Map(CRAFT_APP_PROFILES.flatMap((p) => p.claims.map((c) => [c.id, { profile: p, claim: c }] as const)));

export const profileFor = (appId: string): CraftAppProfile | undefined => BY_APP.get(appId);

export const claimProfile = (claimId: string): { profile: CraftAppProfile; claim: CraftClaimProfile } | undefined => BY_CLAIM.get(claimId);

/** Settings group of an app (D11 G2): any preview claim → view; any sibling extension → sibling; else edit. */
export type CraftAppKind = "edit" | "sibling" | "view";

export function appKind(p: CraftAppProfile): CraftAppKind {
  if (p.claims.some((c) => c.mode === "preview")) return "view";
  if (p.claims.some((c) => (c.siblingExtensions?.length ?? 0) > 0)) return "sibling";
  return "edit";
}

/** Every extension an app claims (settings header), claim order, deduplicated. */
export const appExtensions = (p: CraftAppProfile): string[] => [...new Set(p.claims.flatMap((c) => c.extensions))];

/** The part of a profile the shim reads in the frame (`window.__CRAFT_PROFILE__`). Stable key order. */
export interface FrameProfile {
  appId: string;
  title: { pattern: string; dirtyMarker?: string } | null;
  openedFallbackMs: number | null;
  cleanOnAckedSave: boolean;
  saveName: "stem" | "inner-title";
}

export function frameProfile(p: CraftAppProfile): FrameProfile {
  return {
    appId: p.appId,
    title: p.title ? { pattern: p.title.pattern, ...(p.title.dirtyMarker ? { dirtyMarker: p.title.dirtyMarker } : {}) } : null,
    openedFallbackMs: p.openedFallbackMs ?? null,
    cleanOnAckedSave: p.cleanOnAckedSave,
    saveName: p.saveName,
  };
}
