#!/usr/bin/env node
/**
 * E2E-ONLY seed: populate > 120 ended sessions across dummy directories
 * plus one directory whose only session is outside the snapshot window
 * (older endedAt).
 *
 * Sourced by docker/test-entrypoint.sh under PI_E2E_SEED.
 * See change: fix-connect-snapshot-frame-loss (task 8.1, design D4, test-plan F1/F3).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STUB_DIR_CWD = "/fixtures/stub-dir";
export const STUB_SESSION_ID = "019f0000-0000-7000-8000-000000000001";
export const SEED_SESSIONS_COUNT = 125;

const DAY_MS = 86_400_000;

/**
 * Date prefix of an existing `<prefix>_<sid>.jsonl|.meta.json` record, or
 * `undefined`. A half-written pair is completed under the SAME prefix: the
 * scanner derives the sidecar path from the JSONL basename.
 */
function existingPrefix(dir, sid) {
  for (const f of fs.readdirSync(dir)) {
    for (const suffix of [".jsonl", ".meta.json"]) {
      if (f.endsWith(`_${sid}${suffix}`)) return f.slice(0, -`_${sid}${suffix}`.length);
    }
  }
  return undefined;
}

/** Inverse of the `toISOString().replace(/:/g, "-")` prefix encoding. */
function prefixTime(prefix) {
  return Date.parse(prefix.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3"));
}

/** True when `dir` already holds a `<prefix>_<sid><suffix>` record (any date prefix). */
function hasRecord(dir, sid, suffix) {
  return fs.readdirSync(dir).some((f) => f.endsWith(`_${sid}${suffix}`));
}

/**
 * `now` anchors every timestamp: the boot sweep archives ended sessions older
 * than `sessionList.archiveAfterDays` (default 30), so fixed calendar dates
 * aged out and emptied the stub group. Day-granular (3 days before the seeding
 * day), and idempotent by session id, so a re-seed on a later day adds nothing.
 * See change: fix-sidebar-folder-visibility.
 */
export function seedSessionsWindow(sessionsRoot, now = Date.now()) {
  fs.mkdirSync(sessionsRoot, { recursive: true });

  // 1. Seed 125 ended sessions in distinct directories (1 per dir) with recent timestamps
  const baseTime = Math.floor(now / DAY_MS) * DAY_MS - 3 * DAY_MS + DAY_MS / 2;
  // Oldest window start actually on disk: a recreated stub must stay older than
  // every preserved window session, or it lands inside the snapshot window.
  let oldestWindowStart = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SEED_SESSIONS_COUNT; i++) {
    const sid = `019f0000-0000-7000-8000-${String(i + 10).padStart(12, "0")}`;
    const cwd = `/fixtures/seed-win-${String(i).padStart(3, "0")}`;
    const dirEncoded = `--fixtures-seed-win-${String(i).padStart(3, "0")}--`;
    const dir = path.join(sessionsRoot, dirEncoded);
    fs.mkdirSync(dir, { recursive: true });

    const prior = existingPrefix(dir, sid);
    const startedAt = prior ? prefixTime(prior) : baseTime + i * 1000;
    oldestWindowStart = Math.min(oldestWindowStart, startedAt);
    const endedAt = startedAt + 500;
    const datePrefix = prior ?? new Date(startedAt).toISOString().replace(/:/g, "-");
    const jsonlName = `${datePrefix}_${sid}.jsonl`;
    const metaName = `${datePrefix}_${sid}.meta.json`;

    if (!hasRecord(dir, sid, ".jsonl")) {
      fs.writeFileSync(
        path.join(dir, jsonlName),
        `${JSON.stringify({ type: "session", id: sid, cwd })}\n`,
      );
    }

    if (!hasRecord(dir, sid, ".meta.json")) {
      fs.writeFileSync(
        path.join(dir, metaName),
        `${JSON.stringify({
          cwd,
          status: "ended",
          startedAt,
          endedAt,
          name: `Seed Session ${i}`,
        })}\n`,
      );
    }
  }

  // 2. Seed one directory whose only session is outside the snapshot window
  // Older timestamp so it sorts after the newest 120 ended sessions
  const stubDirEncoded = "--fixtures-stub-dir--";
  const stubDir = path.join(sessionsRoot, stubDirEncoded);
  fs.mkdirSync(stubDir, { recursive: true });

  const stubPrior = existingPrefix(stubDir, STUB_SESSION_ID);
  const stubStartedAt = stubPrior ? prefixTime(stubPrior) : Math.min(baseTime, oldestWindowStart) - 100000000; // far older
  const stubEndedAt = stubStartedAt + 500;
  const stubDatePrefix = stubPrior ?? new Date(stubStartedAt).toISOString().replace(/:/g, "-");
  const stubJsonlName = `${stubDatePrefix}_${STUB_SESSION_ID}.jsonl`;
  const stubMetaName = `${stubDatePrefix}_${STUB_SESSION_ID}.meta.json`;

  if (!hasRecord(stubDir, STUB_SESSION_ID, ".jsonl")) {
    fs.writeFileSync(
      path.join(stubDir, stubJsonlName),
      `${JSON.stringify({ type: "session", id: STUB_SESSION_ID, cwd: STUB_DIR_CWD })}\n`,
    );
  }

  if (!hasRecord(stubDir, STUB_SESSION_ID, ".meta.json")) {
    fs.writeFileSync(
      path.join(stubDir, stubMetaName),
      `${JSON.stringify({
        cwd: STUB_DIR_CWD,
        status: "ended",
        startedAt: stubStartedAt,
        endedAt: stubEndedAt,
        name: "Stub Session",
      })}\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: seed-sessions-window.mjs <sessionsRoot>");
    process.exit(1);
  }
  seedSessionsWindow(root);
  console.log(`[test-entrypoint] PI_E2E_SEED: seeded >120 ended sessions + stub dir in ${root}`);
}
