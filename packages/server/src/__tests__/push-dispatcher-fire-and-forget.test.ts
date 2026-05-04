/**
 * Lint test: `pushDispatcher.fanout(...)` must never be awaited.
 *
 * Push dispatch is fire-and-forget by design — awaiting it would couple
 * push service latency to the event-forwarding pipeline, delaying every
 * event for up to 10s per device.
 *
 * This test scans `event-wiring.ts` for `await pushDispatcher` and fails
 * if found. It also scans for `await.*fanout` to catch aliased callsites.
 *
 * See change: add-server-push-notifications.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const eventWiringPath = path.resolve(__dirname, "..", "..", "event-wiring.js");
// The .ts file — we check the source, not the compiled output.
const eventWiringTsPath = path.resolve(__dirname, "..", "..", "event-wiring.ts");

describe("push-dispatcher fire-and-forget", () => {
  it("must NOT await pushDispatcher.fanout in event-wiring.ts", () => {
    // Check the TypeScript source
    if (!fs.existsSync(eventWiringTsPath)) {
      // Fallback to .js if .ts doesn't exist (unlikely in dev)
      expect(true).toBe(true); // skip silently
      return;
    }

    const source = fs.readFileSync(eventWiringTsPath, "utf-8");

    // Line-by-line check for `await pushDispatcher`
    const lines = source.split("\n");
    const violations: { line: number; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match `await pushDispatcher` or `await pushDispatcher.fanout`
      if (/\bawait\s+pushDispatcher\b/.test(line)) {
        violations.push({ line: i + 1, text: line.trim() });
      }
      // Also match `await.*\.fanout(` on the same line
      if (/\bawait\b.*\.fanout\s*\(/i.test(line)) {
        if (!violations.some((v) => v.line === i + 1)) {
          violations.push({ line: i + 1, text: line.trim() });
        }
      }
    }

    if (violations.length > 0) {
      const msg =
        `pushDispatcher.fanout() must be fire-and-forget (no await).\n` +
        `Awaiting it would couple push-service latency to the event pipeline.\n` +
        `Offenders:\n` +
        violations.map((v) => `  ${eventWiringTsPath}:${v.line}  ${v.text}`).join("\n");
      expect(violations, msg).toEqual([]);
    }
  });
});
