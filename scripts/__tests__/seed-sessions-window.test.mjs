import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_SESSIONS_COUNT, STUB_SESSION_ID, seedSessionsWindow } from "../seed-sessions-window.mjs";

describe("seed-sessions-window", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "seed-win-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("seeds >120 ended sessions plus the stub dir", () => {
    seedSessionsWindow(tmp);

    // 125 seed dirs + 1 stub dir = 126 dirs.
    expect(readdirSync(tmp).length).toBe(SEED_SESSIONS_COUNT + 1);
    expect(SEED_SESSIONS_COUNT).toBeGreaterThan(120);

    const stubDir = join(tmp, "--fixtures-stub-dir--");
    expect(existsSync(stubDir)).toBe(true);
    const stubFiles = readdirSync(stubDir);
    expect(stubFiles.some((f) => f.includes(STUB_SESSION_ID) && f.endsWith(".jsonl"))).toBe(true);
    expect(stubFiles.some((f) => f.includes(STUB_SESSION_ID) && f.endsWith(".meta.json"))).toBe(true);

    // Idempotency: re-running does not throw or duplicate trees.
    seedSessionsWindow(tmp);
    expect(readdirSync(tmp).length).toBe(SEED_SESSIONS_COUNT + 1);
  });

  // The boot sweep archives ended sessions older than `archiveAfterDays`
  // (default 30). Fixed calendar timestamps aged out and emptied the seeded
  // stub group, so every timestamp is relative to the seeding day.
  // See change: fix-sidebar-folder-visibility.
  it("dates every seeded session within the 30-day archive threshold, stub oldest", () => {
    const DAY = 86_400_000;
    const now = Date.UTC(2027, 0, 15, 9, 30);
    seedSessionsWindow(tmp, now);
    const metas = [];
    for (const d of readdirSync(tmp)) {
      for (const f of readdirSync(join(tmp, d)).filter((x) => x.endsWith(".meta.json"))) {
        metas.push({ dir: d, ...JSON.parse(readFileSync(join(tmp, d, f), "utf8")) });
      }
    }
    expect(metas).toHaveLength(SEED_SESSIONS_COUNT + 1);
    for (const m of metas) {
      expect(now - m.endedAt).toBeGreaterThan(0);
      expect(now - m.endedAt).toBeLessThan(7 * DAY);
    }
    const stub = metas.find((m) => m.dir === "--fixtures-stub-dir--");
    const oldestWindow = Math.min(...metas.filter((m) => m !== stub).map((m) => m.endedAt));
    expect(stub.endedAt).toBeLessThan(oldestWindow);
  });

  it("does not duplicate a session when re-seeded on a later day", () => {
    const now = Date.UTC(2027, 0, 15, 9, 30);
    seedSessionsWindow(tmp, now);
    seedSessionsWindow(tmp, now + 2 * 86_400_000);
    for (const d of readdirSync(tmp)) {
      expect(readdirSync(join(tmp, d))).toHaveLength(2);
    }
  });

  it("completes a half-written pair under the existing record's date prefix", () => {
    const now = Date.UTC(2027, 0, 15, 9, 30);
    seedSessionsWindow(tmp, now);
    const stubDir = join(tmp, "--fixtures-stub-dir--");
    const meta = readdirSync(stubDir).find((f) => f.endsWith(".meta.json"));
    unlinkSync(join(stubDir, meta));
    seedSessionsWindow(tmp, now + 2 * 86_400_000);
    const files = readdirSync(stubDir).sort();
    expect(files).toHaveLength(2);
    expect(files[0].replace(/\.jsonl$/, "")).toBe(files[1].replace(/\.meta\.json$/, ""));
    // …and with the original timestamp, so the stub stays outside the window.
    const m = JSON.parse(readFileSync(join(stubDir, files[1]), "utf8"));
    expect(new Date(m.startedAt).toISOString().replace(/:/g, "-")).toBe(files[0].split("_")[0]);
  });

  it("recreates a missing stub older than the preserved window sessions", () => {
    const now = Date.UTC(2027, 0, 15, 9, 30);
    seedSessionsWindow(tmp, now);
    rmSync(join(tmp, "--fixtures-stub-dir--"), { recursive: true, force: true });
    seedSessionsWindow(tmp, now + 2 * 86_400_000);
    const read = (d) => {
      const f = readdirSync(join(tmp, d)).find((x) => x.endsWith(".meta.json"));
      return JSON.parse(readFileSync(join(tmp, d, f), "utf8"));
    };
    const windowStarts = readdirSync(tmp).filter((d) => d !== "--fixtures-stub-dir--").map((d) => read(d).startedAt);
    expect(read("--fixtures-stub-dir--").endedAt).toBeLessThan(Math.min(...windowStarts));
  });
});
