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

export function seedSessionsWindow(sessionsRoot) {
  fs.mkdirSync(sessionsRoot, { recursive: true });

  // 1. Seed 125 ended sessions in distinct directories (1 per dir) with recent timestamps
  // Baseline time = 2026-09-01T12:00:00.000Z
  const baseTime = 1788264000000;
  for (let i = 0; i < SEED_SESSIONS_COUNT; i++) {
    const sid = `019f0000-0000-7000-8000-${String(i + 10).padStart(12, "0")}`;
    const cwd = `/fixtures/seed-win-${String(i).padStart(3, "0")}`;
    const dirEncoded = `--fixtures-seed-win-${String(i).padStart(3, "0")}--`;
    const dir = path.join(sessionsRoot, dirEncoded);
    fs.mkdirSync(dir, { recursive: true });

    const startedAt = baseTime + i * 1000;
    const endedAt = startedAt + 500;
    const datePrefix = new Date(startedAt).toISOString().replace(/:/g, "-");
    const jsonlName = `${datePrefix}_${sid}.jsonl`;
    const metaName = `${datePrefix}_${sid}.meta.json`;

    if (!fs.existsSync(path.join(dir, jsonlName))) {
      fs.writeFileSync(
        path.join(dir, jsonlName),
        `${JSON.stringify({ type: "session", id: sid, cwd })}\n`,
      );
    }

    if (!fs.existsSync(path.join(dir, metaName))) {
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

  const stubStartedAt = baseTime - 100000000; // far older
  const stubEndedAt = stubStartedAt + 500;
  const stubDatePrefix = new Date(stubStartedAt).toISOString().replace(/:/g, "-");
  const stubJsonlName = `${stubDatePrefix}_${STUB_SESSION_ID}.jsonl`;
  const stubMetaName = `${stubDatePrefix}_${STUB_SESSION_ID}.meta.json`;

  if (!fs.existsSync(path.join(stubDir, stubJsonlName))) {
    fs.writeFileSync(
      path.join(stubDir, stubJsonlName),
      `${JSON.stringify({ type: "session", id: STUB_SESSION_ID, cwd: STUB_DIR_CWD })}\n`,
    );
  }

  if (!fs.existsSync(path.join(stubDir, stubMetaName))) {
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
