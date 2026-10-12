/**
 * Mirror of the client reducer's `CUSTOM_BODY_MAX_CHARS` (64 000): a row body at
 * or above this length was tail-sliced with no marker, so it is partial. The
 * plugin cannot import the client package, so the value is duplicated here and
 * pinned by a drift-guard test (parse-web-search.test.ts).
 *
 * See change: render-unclaimed-custom-entries.
 */
export const CUSTOM_BODY_MAX_CHARS = 64_000;
