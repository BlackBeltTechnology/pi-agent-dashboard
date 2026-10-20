// Zip-container sanity checks for the craft apps' own bundle formats (D7). Central directory only, plus the
// small `mimetype` member. Parametrized per extension:
//   .designcraft  mimetype application/vnd.designcraft+zip, document.json
//   .scraftz      exactly one top-level *.scraft (session); `Audio Files/` optional
//   .deckcraft    mimetype application/vnd.storyteller.deckcraft+zip, presentation.json
// See change: extend-craft-web-to-all-apps.
import { OK, reject } from "./text-window.mjs";
import { readZipDirectory, readZipMember } from "./zip.mjs";

/** @type {Record<string, {mimetype?: string, required?: string[], oneTopLevel?: string}>} */
const ZIP_RULES = {
  ".designcraft": { mimetype: "application/vnd.designcraft+zip", required: ["document.json"] },
  ".scraftz": { oneTopLevel: ".scraft" },
  ".deckcraft": { mimetype: "application/vnd.storyteller.deckcraft+zip", required: ["presentation.json"] },
};

/** @param {Uint8Array} bytes @param {string} ext */
export function validateZipMembers(bytes, ext) {
  const rule = ZIP_RULES[ext];
  if (!rule) return reject(`no zip rule for ${ext}`);
  const dir = readZipDirectory(bytes);
  if (dir.error) return reject(dir.error);
  const names = new Set(dir.entries.map((e) => e.name));
  if (rule.mimetype) {
    const entry = dir.entries.find((e) => e.name === "mimetype");
    if (!entry) return reject("mimetype member is missing");
    const m = readZipMember(bytes, dir.view, entry, 256);
    if (m.error) return reject(m.error);
    if (Buffer.from(m.data).toString("latin1").trim() !== rule.mimetype) return reject(`mimetype is not ${rule.mimetype}`);
  }
  for (const r of rule.required ?? []) if (!names.has(r)) return reject(`${r} is missing`);
  if (rule.oneTopLevel) {
    const suffix = rule.oneTopLevel;
    const top = [...names].filter((n) => !n.includes("/") && n.toLowerCase().endsWith(suffix));
    if (top.length !== 1) return reject(`expected exactly one top-level *${suffix}, found ${top.length}`);
  }
  return OK;
}
