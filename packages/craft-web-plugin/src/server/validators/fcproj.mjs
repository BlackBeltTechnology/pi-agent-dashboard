// FilmCraft project (`.fcproj`) sanity check (add-craft-web-media-projects D4): FilmCraft 0.12.0 saves a JSON
// object `{"format":"filmcraft.project","schema_version":<n>,"generator":…,"project":{…}}`. Bounded: the format,
// schema_version and project keys (in any order) within the first 4 KiB, the text starts with `{` and ends with
// `}`. No JSON is parsed here.
import { head, OK, reject, tail } from "./text-window.mjs";

/** @param {Uint8Array} bytes */
export function validateFcproj(bytes) {
  const h = head(bytes, 4096).replace(/^\uFEFF/, "");
  if (!/^\s*\{/.test(h)) return reject("not a JSON object");
  if (!/"format"\s*:\s*"filmcraft\.project"/.test(h)) return reject('missing "format": "filmcraft.project"');
  if (!/"schema_version"\s*:\s*\d+/.test(h)) return reject("missing schema_version");
  if (!/"project"\s*:\s*\{/.test(h)) return reject("missing project object");
  if (!/\}\s*$/.test(tail(bytes, 64))) return reject("truncated document");
  return OK;
}
