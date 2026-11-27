/**
 * Teammate name of a change (design D3): `os-<change>` when that has at most 32 characters, else `os-` + the
 * first 22 characters of the change (trailing `-` trimmed) + `-` + the first 6 hex characters of
 * `sha256(change)`. The result always satisfies core's member-name rule `^[a-z][a-z0-9-]{0,31}$`, never holds a
 * double dash (change names have none) and is a pure function of the change name, so it is stable across
 * restarts. The mapping name → change is also recorded in the sidecar (`names`) by the seed.
 * See change: add-agent-teams-openspec.
 */
import { createHash } from "node:crypto";
import { isChangeName } from "./inputs.js";

const PREFIX = "os-";
const MAX_NAME = 32;
const HEAD_CHARS = 22;

export function memberNameFor(change: string): string {
  if (!isChangeName(change)) throw new TypeError("memberNameFor: not a change name");
  const plain = `${PREFIX}${change}`;
  if (plain.length <= MAX_NAME) return plain;
  const hash = createHash("sha256").update(change).digest("hex").slice(0, 6);
  return `${PREFIX}${change.slice(0, HEAD_CHARS).replace(/-+$/, "")}-${hash}`;
}
