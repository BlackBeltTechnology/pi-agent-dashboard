#!/usr/bin/env node
/**
 * pi-transcribe — transcribe local video/audio to speaker-diarized SRT.
 *
 * Usage:
 *   pi-transcribe                      scan ~/Movies (default)
 *   pi-transcribe /path/to/recordings  scan a directory
 *   pi-transcribe a.m4a b.mp4          transcribe explicit files
 *
 * Runs as TypeScript via pi's jiti loader (no build step). Non-zero exit only
 * on hard config errors (e.g. missing SONIOX_API_KEY); per-file failures are
 * reported in the summary without aborting the run.
 */
import { run } from "../run.js";

async function main(): Promise<void> {
  try {
    await run(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
}

void main();
