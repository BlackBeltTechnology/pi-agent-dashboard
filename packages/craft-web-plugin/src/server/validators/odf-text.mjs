// ODF text (`.odt`) sanity check (D7): a zip whose FIRST member is a STORED `mimetype` holding exactly
// `application/vnd.oasis.opendocument.text`, plus a `content.xml` member. No XML part is parsed.
// See change: extend-craft-web-to-all-apps.
import { OK, reject } from "./text-window.mjs";
import { readZipDirectory, readZipMember } from "./zip.mjs";

const MIMETYPE = "application/vnd.oasis.opendocument.text";

/** @param {Uint8Array} bytes */
export function validateOdfText(bytes) {
  const dir = readZipDirectory(bytes);
  if (dir.error) return reject(dir.error);
  const first = dir.entries.find((e) => e.localOffset === 0);
  if (!first || first.name !== "mimetype") return reject("the first zip member must be mimetype");
  if (first.method !== 0) return reject("mimetype must be stored uncompressed");
  const m = readZipMember(bytes, dir.view, first, 256);
  if (m.error) return reject(m.error);
  if (Buffer.from(m.data).toString("latin1") !== MIMETYPE) return reject(`mimetype is not ${MIMETYPE}`);
  if (!dir.entries.some((e) => e.name === "content.xml")) return reject("content.xml is missing");
  return OK;
}
