// DWG sanity check (D7): the `AC10xx` version string at offset 0, xx a release from R13 to R2018.
// See change: extend-craft-web-to-all-apps.
import { head, OK, reject } from "./text-window.mjs";

/** R13 AC1012, R14 AC1014, R2000 AC1015, R2004 AC1018, R2007 AC1021, R2010 AC1024, R2013 AC1027, R2018 AC1032. */
const VERSIONS = new Set(["AC1012", "AC1014", "AC1015", "AC1018", "AC1021", "AC1024", "AC1027", "AC1032"]);

/** @param {Uint8Array} bytes */
export function validateDwg(bytes) {
  const v = head(bytes, 6);
  if (!VERSIONS.has(v)) return reject(`unsupported DWG version string ${JSON.stringify(v)}`);
  if (bytes.length < 128) return reject("DWG too short");
  return OK;
}
