/**
 * Install source of the required `pi-anthropic-messages` peer — its own tiny
 * module so the client's cold-landing peer probe (`anthropic-peer.ts`) can
 * read it without pulling `recommended-extensions.ts` (every entry's
 * description) into the gzipped index chunk (mdi-chunk-size cap). Bundlers
 * keep a module whole, so a sibling export of the manifest would not help.
 */
export const ANTHROPIC_MESSAGES_SOURCE = "npm:@blackbelt-technology/pi-anthropic-messages";
