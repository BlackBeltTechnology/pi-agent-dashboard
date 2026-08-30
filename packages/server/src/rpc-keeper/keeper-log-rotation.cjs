"use strict";

/**
 * Keeper-log rotation — bounded-growth core for keeper.cjs.
 *
 * Extracted from the keeper script (but still CJS-pure, Node built-ins only)
 * so the rotation contract is unit-testable with a stubbed `fs`: the rotation
 * fault paths (EPERM fallback, swapped path, double failure) and the hot-path
 * throttle are exactly the scenarios a spawned-process integration test
 * cannot observe from outside.
 *
 * Contract (openspec/changes/fix-runaway-keeper-log-growth, design D1-D4):
 *   - At/over `maxBytes`, truncate IN PLACE: `ftruncateSync(logFd, 0)`.
 *     No rename, no reopen, no copy, no retained generation.
 *   - On Windows, `ftruncateSync` on an O_APPEND handle can fail (EPERM —
 *     libuv opens append-only handles without FILE_WRITE_DATA). Fall back to
 *     `truncateSync(logPath, 0)` ONLY after verifying the path still names
 *     the same inode the fd points at.
 *   - Checks are throttled: at most one `fstatSync` per `checkIntervalMs`,
 *     from BOTH call sites (the keeper's log() hot path and the unref'd
 *     interval timer).
 *   - Success is SILENT. Rotation is a logging concern; a success line would
 *     itself re-grow the log and would violate the "no keeper-originated
 *     line after child bytes" capture invariant. Failures log a WARN.
 *   - Nothing here may ever throw into the caller: the keeper installs
 *     `uncaughtException → shutdown(1)`, and a logging concern must never
 *     end the session.
 */

const fs = require("fs");

const KEEPER_LOG_MAX_BYTES_DEFAULT = 134217728; // 128 MiB
const KEEPER_LOG_CHECK_INTERVAL_MS_DEFAULT = 5000;

/**
 * Env-var parsing for the CJS keeper (which cannot import the shared config).
 * Unset / empty / non-integer / <= 0 → fallback. Mirrors
 * `parseKeeperLogPositiveInt` in packages/shared/src/config.ts — the two must
 * stay in agreement; a config value that parses server-side must not be
 * rejected keeper-side.
 */
function parsePositiveIntEnv(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/**
 * @param {object} opts
 * @param {number} opts.logFd        Open append-mode fd of the keeper log.
 * @param {string} opts.logPath      Path the fd was opened from.
 * @param {(line: string) => void} opts.log  Keeper logger (timestamped).
 * @param {number} opts.maxBytes     Rotation cap in bytes.
 * @param {number} opts.checkIntervalMs  Throttle window + timer cadence (ms).
 * @param {object} [opts.fs]         fs namespace override (tests).
 * @param {() => number} [opts.now]  Clock override (tests).
 */
function createKeeperLogRotation(opts) {
  const fsMod = opts.fs || fs;
  const maxBytes = opts.maxBytes;
  const checkIntervalMs = opts.checkIntervalMs;
  const log = opts.log;
  const now = opts.now || Date.now;

  let lastCheckAt = 0;
  let timer = null;

  /**
   * One throttled size check. Cheap when throttled (one Date.now compare);
   * when it fires, two constant-time syscalls at most (fstat + ftruncate),
   * regardless of file size.
   */
  function rotateIfNeeded() {
    const t = now();
    if (t - lastCheckAt < checkIntervalMs) return;
    // Advance the throttle BEFORE any work so failure WARNs (which re-enter
    // via log()) cannot re-trigger a check within the same window.
    lastCheckAt = t;
    try {
      let st;
      try {
        // fstatSync(logFd), NOT statSync(logPath): the check must read the
        // same object the writes go to, immune to a path swapped or unlinked
        // underneath (design D3).
        st = fsMod.fstatSync(opts.logFd);
      } catch (e) {
        log(`WARN keeper-log size check failed (fstat): ${e && e.message}`);
        return;
      }
      if (st.size < maxBytes) return;
      try {
        // Truncate IN PLACE on the descriptor — the inode survives. Both the
        // keeper and (with capture on) the pi child hold O_APPEND handles to
        // the same open file description; after truncation each subsequent
        // write recomputes its append offset against the now-zero-length
        // file, so neither writer needs to be signalled, reopened, or
        // restarted. (Load-bearing invariant: every writer holds O_APPEND.)
        //
        // NO rename/reopen: `stdio: [_, logFd, logFd]` dups logFd into the pi
        // child, which keeps writing into the renamed inode — the exact
        // failure that produced the multi-GB residue. NO copy: it would stall
        // the keeper's single event loop against the 350 ms RPC attempt
        // budget. NO retained generation: keeper shutdown never unlinks the
        // log, so .1 files would accumulate one per dead session — the same
        // unbounded-directory disease, one order down.
        // See change: fix-runaway-keeper-log-growth (D1/D2).
        fsMod.ftruncateSync(opts.logFd, 0);
      } catch (fdErr) {
        // Windows fallback: libuv can open O_APPEND handles without
        // FILE_WRITE_DATA, so SetEndOfFile (ftruncate) may fail EPERM there.
        // truncateSync(path) opens its own handle (libuv shares
        // READ|WRITE|DELETE with the existing ones) and truncates the same
        // inode — but only after verifying the path still names the inode
        // this fd points at. Truncating a swapped-in replacement would report
        // success while the over-cap file kept growing (design D4).
        let pst = null;
        try {
          pst = fsMod.statSync(opts.logPath);
        } catch (_pathErr) {
          pst = null;
        }
        if (pst && pst.ino === st.ino) {
          try {
            fsMod.truncateSync(opts.logPath, 0);
          } catch (pathErr) {
            log(`WARN keeper-log rotation failed (fd + path): ${pathErr && pathErr.message}`);
          }
        } else {
          // Rotation recorded as failed. Cross-process, the same condition
          // surfaces via /api/health keeperLogs.runawayFiles.
          log(
            "WARN keeper-log rotation refused: log path no longer names the fd's inode (replaced/swapped under an over-cap log)",
          );
        }
      }
    } catch (e) {
      // Belt and braces: rotation must NEVER throw into log() or the timer
      // callback — an uncaught throw reaches the keeper's
      // uncaughtException → shutdown(1) and ends the session over a logging
      // concern (design D3).
      try {
        log(`WARN keeper-log rotation internal error: ${e && e.message}`);
      } catch (_swallowed) {
        /* even the WARN must not throw */
      }
    }
  }

  /** Start the unref'd interval timer (child-driven growth produces no log() calls). */
  function start() {
    if (timer) return;
    timer = setInterval(() => {
      rotateIfNeeded();
    }, checkIntervalMs);
    // unref: the timer must not keep the keeper alive past pi's exit.
    timer.unref();
    return timer;
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { rotateIfNeeded, start, stop };
}

module.exports = {
  createKeeperLogRotation,
  parsePositiveIntEnv,
  KEEPER_LOG_MAX_BYTES_DEFAULT,
  KEEPER_LOG_CHECK_INTERVAL_MS_DEFAULT,
};
