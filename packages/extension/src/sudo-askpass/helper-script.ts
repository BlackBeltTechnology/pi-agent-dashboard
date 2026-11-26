/**
 * Source of the askpass helper and its shell wrapper (D10).
 *
 * The wrapper is a `/bin/sh` script that clears `NODE_OPTIONS`/`NODE_PATH` and
 * execs the ABSOLUTE interpreter (`process.execPath`), never `env node`, since the
 * agent controls `PATH` and `NODE_OPTIONS` in the bash call. The helper has the
 * socket path baked in (no env), writes the answer only to stdout, never to argv,
 * env or stderr, and prints one fixed message on any failure.
 *
 * See change: add-sudo-credential-prompt (D10).
 */

import { SUDO_HELPER_OK_MAGIC } from "./protocol.js";

/** The only text the helper ever writes to stderr (sudo's stderr is tool output). */
export const SUDO_HELPER_FAILURE_MESSAGE = "pi-dashboard askpass: no credential provided\n";

/** Longest bridge answer the helper will buffer (max password is 1 024 chars). */
const MAX_ANSWER_BYTES = 16 * 1024;

export function buildHelperSource(socketPath: string): string {
  return `"use strict";
const net = require("net");
const fs = require("fs");
const MAGIC = Buffer.from(${JSON.stringify(SUDO_HELPER_OK_MAGIC.toString("latin1"))}, "latin1");
let done = false;
function fail() {
  if (done) return;
  done = true;
  try { fs.writeSync(2, ${JSON.stringify(SUDO_HELPER_FAILURE_MESSAGE)}); } catch (e) {}
  process.exit(1);
}
function finish(chunks) {
  if (done) return;
  const buf = Buffer.concat(chunks);
  if (buf.length <= MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) return fail();
  done = true;
  process.stdout.write(buf.subarray(MAGIC.length), function () { process.exit(0); });
}
try {
  const chunks = [];
  let size = 0;
  const conn = net.createConnection(${JSON.stringify(socketPath)});
  conn.on("connect", function () {
    conn.write(JSON.stringify({ promptText: process.argv[2] === undefined ? "" : String(process.argv[2]), ppid: process.ppid }) + "\\n");
  });
  conn.on("data", function (d) {
    size += d.length;
    if (size > ${MAX_ANSWER_BYTES}) return fail();
    chunks.push(d);
  });
  conn.on("end", function () { finish(chunks); });
  conn.on("error", fail);
  conn.on("close", function () { finish(chunks); });
} catch (e) {
  fail();
}
`;
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** `/bin/sh` wrapper: scrub node env, exec the absolute interpreter on the helper file. */
export function buildWrapperSource(execPath: string, helperPath: string): string {
  return `#!/bin/sh
unset NODE_OPTIONS NODE_PATH
exec ${shQuote(execPath)} ${shQuote(helperPath)} "$@"
`;
}
