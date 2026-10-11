#!/usr/bin/env node
/**
 * pi-voiceid — local, offline speaker enrollment for diarized SRT files.
 *
 * Usage:
 *   pi-voiceid enroll --name "Alice" --srt talk.srt --label "Speaker 1"
 *   pi-voiceid list
 *   pi-voiceid analyze --srt talk.srt
 *   pi-voiceid label   --srt talk.srt --dry-run
 *   pi-voiceid forget  --name "Alice"
 *
 * Runs as TypeScript via pi's jiti loader (no build step). Exits non-zero on a
 * failed command; per-command errors are printed without a stack trace.
 */
import { runVoiceId } from "../voiceid.js";

runVoiceId(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
