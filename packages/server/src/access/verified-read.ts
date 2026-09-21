/**
 * Handle-verified byte serving for grant-admitted reads (design D14, task 2.8).
 *
 * The containment check and the byte read are two syscalls, so a path can be
 * swapped between them: check `/a/b/ok.txt` (granted, inside the anchor), then
 * replace it with a symlink to `/etc/passwd` before the site opens it. The check
 * passed, but on a path that is no longer the file being served. That is the
 * classic check→open TOCTOU window.
 *
 * The fix is not to re-check the path — a second check races identically — but
 * to verify the thing that will actually be read: the OPEN HANDLE.
 *
 *   1. `lstat` FIRST and require a regular file. This is load-bearing beyond
 *      correctness: `open(2)` on a FIFO BLOCKS until a writer appears, so a
 *      granted directory containing a FIFO would otherwise hold a request open
 *      indefinitely. Refusing before any `open` is what keeps that from being a
 *      denial-of-service vector (scenario X14).
 *   2. `open` with `O_NOFOLLOW` (+ `O_NONBLOCK` where the platform has it), so a
 *      final component swapped to a symlink or FIFO in the gap is refused by the
 *      kernel rather than followed or blocked on.
 *   3. `fstat` the HANDLE and require it to be the same regular file the `lstat`
 *      described — same device, same inode. If the path was retargeted in the
 *      gap, the inode differs and we refuse.
 *   4. Hand back the handle. The caller serves bytes FROM IT, so no third
 *      resolution of the path happens between the check and the read.
 *
 * Limits — stated because this guarantee is easy to overclaim:
 *   - `O_NOFOLLOW` covers the FINAL path component only, and step 3 binds the
 *     handle to the `lstat` of the SAME path, not to the realpath that
 *     `isGrantAdmitted` approved. A directory component inside the granted tree
 *     that is swapped for a symlink between the containment `realpath` and the
 *     `lstat` is followed by both consistently, so dev+ino still match. That
 *     residual requires write access inside the granted directory to exploit;
 *     closing it needs a per-component `openat` walk.
 *   - A hardlink inside the granted tree pointing at a file outside it is
 *     admitted: `realpath` does not resolve hardlinks, and the inode genuinely
 *     IS the target. Inherent to a realpath-based subtree predicate.
 *
 * Scope (task 2.8): GRANT-ADMITTED reads only. Layers ①/② have an identical
 * pre-existing window that this change deliberately does not touch — closing it
 * is a separate, broader change. Callers therefore invoke this only when the
 * containment decision reported `viaGrant`.
 *
 * `assertRegularFile` exists for the OFFICE gate, which hands a PATH to an
 * out-of-process renderer (document-converter/LibreOffice) and so cannot serve
 * from a handle — it gets a regular-file assertion, not handle binding. The EML
 * gates DO serve from a handle (they read the verified bytes and parse them in
 * process), so they are handle-verified, not merely asserted. See the note on
 * that function for exactly what it does and does not close.
 *
 * See change: add-access-grants-and-review (D14).
 */
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

/** Why a grant-admitted byte-serving read was refused. */
export type VerifiedReadRefusalReason =
  /** The path is not a regular file (directory, FIFO, device, or symlink). */
  | "not-regular"
  /** The opened handle is not the file that was checked — the path was swapped. */
  | "handle-mismatch";

/**
 * A grant-admitted byte-serving read was refused because the file behind the
 * path is not the regular file the containment check approved.
 *
 * Callers translate this into the site's EXISTING containment refusal, so the
 * per-site `error` strings and status codes stay byte-identical (design D7).
 */
export class VerifiedReadRefused extends Error {
  readonly reason: VerifiedReadRefusalReason;
  readonly subject: string;

  constructor(reason: VerifiedReadRefusalReason, subject: string) {
    super(`refused grant-admitted read of ${subject}: ${reason}`);
    this.name = "VerifiedReadRefused";
    this.reason = reason;
    this.subject = subject;
  }
}

/**
 * `O_NOFOLLOW`/`O_NONBLOCK` are POSIX; on Windows they are absent and the
 * bitwise-or must not introduce `NaN`. Falling back to 0 there is safe — the
 * `lstat` + `fstat` pair still binds the handle to the checked inode.
 */
const OPEN_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** Under `O_NOFOLLOW`, `open(2)` reports a symlinked final component as ELOOP/EMLINK. */
const SYMLINK_ERRNOS = new Set(["ELOOP", "EMLINK"]);

/**
 * Open a grant-admitted path for byte serving, verifying that the returned
 * handle is the same regular file the containment layer approved.
 *
 * The caller OWNS the handle and must close it on its own error paths; on any
 * refusal raised here it has already been closed.
 *
 * Throws `VerifiedReadRefused` for a non-regular file or a swapped path, and
 * propagates `ENOENT`/`EACCES` unchanged so the site's existing 404/500 handling
 * still applies.
 */
export async function openVerifiedRegularFile(resolved: string): Promise<FileHandle> {
  const linkStat = await fs.lstat(resolved);
  if (!linkStat.isFile()) throw new VerifiedReadRefused("not-regular", resolved);

  let handle: FileHandle;
  try {
    handle = await fs.open(resolved, OPEN_FLAGS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && SYMLINK_ERRNOS.has(code)) {
      throw new VerifiedReadRefused("not-regular", resolved);
    }
    throw err;
  }

  try {
    const handleStat = await handle.stat();
    if (
      !handleStat.isFile() ||
      handleStat.dev !== linkStat.dev ||
      handleStat.ino !== linkStat.ino
    ) {
      throw new VerifiedReadRefused("handle-mismatch", resolved);
    }
    return handle;
  } catch (err) {
    await handle.close().catch(() => {});
    throw err;
  }
}

/**
 * Refuse a grant-admitted path that is not a regular file, for sites that must
 * hand the PATH to an out-of-process renderer.
 *
 * This closes the blocking hazard — a granted FIFO can never be opened, so a
 * request cannot hang on it (scenario X14) — but NOT the inode bind: the
 * renderer re-resolves the path itself, so a swap after this check is still
 * possible. Closing that would need the renderer to accept a descriptor, which
 * is out of scope here. Callers apply it only when the decision reported
 * `viaGrant`.
 */
export async function assertRegularFile(resolved: string): Promise<void> {
  const linkStat = await fs.lstat(resolved);
  if (!linkStat.isFile()) throw new VerifiedReadRefused("not-regular", resolved);
}

/**
 * Read a grant-admitted file entirely from the verified handle, closing it
 * before returning. For sites that consume bytes IN PROCESS (the spreadsheet
 * parser, the session-file read) this is strictly better than
 * `assertRegularFile`: the bytes come from the descriptor that was checked, so
 * there is no third resolution of the path to race.
 */
export async function readFileVerified(resolved: string): Promise<Buffer> {
  const handle = await openVerifiedRegularFile(resolved);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** `readFileVerified` decoded as UTF-8. */
export async function readFileVerifiedUtf8(resolved: string): Promise<string> {
  return (await readFileVerified(resolved)).toString("utf-8");
}
