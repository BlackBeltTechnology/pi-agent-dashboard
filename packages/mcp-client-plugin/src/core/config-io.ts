/**
 * mcp-client-plugin · real filesystem ConfigIO.
 *
 * The hardened atomic write moved here from `apple-tools/src/env.ts` so the
 * core owns it and every consumer (dashboard server, hostless installer CLI)
 * shares one implementation:
 *  - `wx` + a random name: never follow or clobber a pre-planted symlink.
 *  - mode 0600: a rename carries the temp file's mode onto the destination.
 *  - fsync before rename: no zero-length config after a crash.
 *  - unlink the temp on failure: no leftovers on ENOSPC/EACCES.
 *
 * See change: extract-mcp-client-plugin (task 2.1).
 */

import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ConfigIO } from "./types.js";

export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    const buf = Buffer.from(content, "utf8");
    let off = 0;
    while (off < buf.length) {
      off += writeSync(fd, buf, off, buf.length - off);
    }
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw e;
  }
}

/** A ConfigIO wired to the real filesystem. */
export function createRealConfigIO(): ConfigIO {
  return {
    readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
    writeFileAtomic,
  };
}
