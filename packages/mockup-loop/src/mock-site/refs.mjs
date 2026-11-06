// @ts-check
// Reference grammar for the live-component mock site. Pure: shared by the node
// plugin, the `mock-decide` CLI, and the browser shell (no node imports).
//   <id> | <id>/<frame> | <id>/<frame>/<side> | <id>/<frame>/<side>/<ring|step-<k>>
// See change: add-live-component-mock-site (design D7), add-mock-site-exact-env (D5).

/** Mock id = directory name: `<yyyy-mm-dd>-<slug>`. */
export const MOCK_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
/** Ring number segment (a ref segment, so no `/`). */
export const RING_RE = /^[A-Za-z0-9-]+$/;
/** Step segment: `step-<k>`, k 1-based. Reserved: a ring `n` never starts with `step-`. */
const STEP_RE = /^step-[1-9]\d*$/;

/** A valid ring `n`: ref-safe and not in the reserved `step-` space. @param {unknown} n */
export const isRingN = (n) => RING_RE.test(String(n)) && !String(n).startsWith("step-");

/**
 * @typedef {{ id: string, frame?: number, side?: "current"|"proposed", ring?: string, step?: number }} Ref
 */

/**
 * Parse a mock id, a `#ref`, or a full site URL (its hash) into a Ref.
 * Throws `Error("bad ref …")` naming the offending segment.
 * @param {string} input
 * @returns {Ref}
 */
export function parseRef(input) {
  let s = String(input ?? "").trim();
  if (/^[a-z]+:\/\//i.test(s)) {
    const i = s.indexOf("#");
    if (i < 0) throw new Error(`bad ref: URL has no #<id> hash: ${input}`);
    s = s.slice(i + 1);
  } else if (s.startsWith("#")) s = s.slice(1);
  if (!s) throw new Error("bad ref: empty");
  const parts = s.split("/");
  if (parts.length > 4) throw new Error(`bad ref: too many segments in ${s}`);
  const [id, frame, side, ring] = parts;
  if (!MOCK_ID_RE.test(id)) throw new Error(`bad ref: id "${id}" must match yyyy-mm-dd-slug`);
  /** @type {Ref} */
  const out = { id };
  if (frame === undefined) return out;
  if (!/^[1-9]\d*$/.test(frame)) throw new Error(`bad ref: frame "${frame}" must be 1-based`);
  out.frame = Number(frame);
  if (side === undefined) return out;
  if (side !== "current" && side !== "proposed") throw new Error(`bad ref: side "${side}" must be current|proposed`);
  out.side = side;
  if (ring === undefined) return out;
  if (ring.startsWith("step-")) {
    if (!STEP_RE.test(ring)) throw new Error(`bad ref: step "${ring}" must be step-<k>, k 1-based`);
    out.step = Number(ring.slice(5));
    return out;
  }
  if (!RING_RE.test(ring)) throw new Error(`bad ref: ring "${ring}" must match [A-Za-z0-9-]+`);
  out.ring = ring;
  return out;
}

/** DOM id for a ref string. @param {string} ref */
export const refId = (ref) => `r-${ref}`;
