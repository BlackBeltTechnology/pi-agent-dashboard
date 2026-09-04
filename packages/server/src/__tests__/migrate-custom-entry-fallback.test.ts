/**
 * Tests for the one-shot `customEntryFallback → customEventGroups.other`
 * sweep over per-session `.meta.json` overrides (tasks 6.1–6.2).
 *
 * See change: add-custom-event-group-filters.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrateCustomEntryFallbackOverrides } from "../persistence/migrate-custom-entry-fallback.js";

let sessionsDir: string;

beforeEach(() => {
  sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ceg-mig-"));
});

afterEach(() => {
  fs.rmSync(sessionsDir, { recursive: true, force: true });
});

function writeMeta(id: string, displayPrefsOverride: unknown): void {
  fs.writeFileSync(
    path.join(sessionsDir, `${id}.jsonl.meta.json`),
    JSON.stringify({ displayPrefsOverride }),
  );
}

function readMeta(id: string): any {
  return JSON.parse(fs.readFileSync(path.join(sessionsDir, `${id}.jsonl.meta.json`), "utf-8"));
}

describe("customEntryFallback override sweep (task 6.1)", () => {
  it("migrates a persisted false landing as other:false, dropping the legacy field", () => {
    writeMeta("a", { customEntryFallback: false, debugTools: true });
    const { migratedOverrides } = migrateCustomEntryFallbackOverrides(sessionsDir);
    expect(migratedOverrides).toHaveLength(1);
    const override = readMeta("a").displayPrefsOverride;
    expect(override.customEventGroups).toEqual({ other: false });
    expect(override.customEntryFallback).toBeUndefined();
    expect(override.debugTools).toBe(true); // unrelated fields untouched
  });

  it("the legacy default (true) does not force an explicit other key", () => {
    writeMeta("b", { customEntryFallback: true });
    migrateCustomEntryFallbackOverrides(sessionsDir);
    const override = readMeta("b").displayPrefsOverride;
    expect(override.customEventGroups?.other).toBeUndefined();
    expect(override.customEntryFallback).toBeUndefined();
  });

  it("is idempotent and never overwrites an explicit other choice (task 6.2)", () => {
    writeMeta("c", { customEntryFallback: false, customEventGroups: { other: true } });
    migrateCustomEntryFallbackOverrides(sessionsDir);
    // explicit user choice kept, legacy field dropped
    let override = readMeta("c").displayPrefsOverride;
    expect(override.customEventGroups.other).toBe(true);
    expect(override.customEntryFallback).toBeUndefined();
    // second run: no further migration
    const second = migrateCustomEntryFallbackOverrides(sessionsDir);
    expect(second.migratedOverrides).toHaveLength(0);
    override = readMeta("c").displayPrefsOverride;
    expect(override.customEventGroups.other).toBe(true);
  });

  it("leaves overrides without the legacy field untouched", () => {
    writeMeta("d", { debugTools: true });
    const { migratedOverrides } = migrateCustomEntryFallbackOverrides(sessionsDir);
    expect(migratedOverrides).toHaveLength(0);
    expect(readMeta("d").displayPrefsOverride).toEqual({ debugTools: true });
  });
});
