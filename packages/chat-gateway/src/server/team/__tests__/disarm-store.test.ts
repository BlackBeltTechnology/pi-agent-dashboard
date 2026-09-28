/**
 * Disarm latch persistence (change: add-chat-gateway-team-controls, task 11.3).
 *
 * The latch cannot live in the plugin config — a chat disarm must NOT write
 * config, because the dashboard is the only config writer — so it needs its own
 * durable record. These tests cover the store in isolation; the controller and
 * entry-point tests cover the wiring.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDisarmStore } from "../disarm-store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "disarm-"));
  file = path.join(dir, "nested", "disarm.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("disarm store", () => {
  it("round-trips both states, creating the directory it needs", () => {
    const store = createDisarmStore({ filePath: file });
    store.save(true);
    expect(createDisarmStore({ filePath: file }).load()).toBe(true);
    store.save(false);
    expect(createDisarmStore({ filePath: file }).load()).toBe(false);
  });

  it("distinguishes 'never persisted' from 'persisted false'", () => {
    // The distinction is load-bearing: `undefined` means "no opinion, use the
    // config", while `false` is a real transition (a dashboard re-arm) that must
    // NOT be overridden by a stale `disarmed: true` in config.
    expect(createDisarmStore({ filePath: file }).load()).toBeUndefined();
    createDisarmStore({ filePath: file }).save(false);
    expect(createDisarmStore({ filePath: file }).load()).toBe(false);
  });

  it("writes the file 0600", () => {
    createDisarmStore({ filePath: file }).save(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("returns undefined for corrupt or malformed content rather than throwing", () => {
    const store = createDisarmStore({ filePath: file });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const body of ["{ not json", "null", '"disarmed"', "{}", '{"disarmed":"yes"}']) {
      fs.writeFileSync(file, body, { mode: 0o600 });
      expect(store.load()).toBeUndefined();
    }
  });

  it("does not throw when the file cannot be written", () => {
    // SAFETY: `save` runs on the MESSAGE path. Throwing here would turn a full
    // disk (or a read-only state dir) into a bot that stops answering entirely —
    // a worse failure than a latch that fails to persist.
    const store = createDisarmStore({ filePath: path.join(dir, "afile") });
    fs.writeFileSync(path.join(dir, "afile"), "not a directory", { mode: 0o600 });
    expect(() => store.save(true)).not.toThrow();
  });

  it("is a no-op with no file path, for the in-memory case", () => {
    const store = createDisarmStore({});
    expect(store.load()).toBeUndefined();
    expect(() => store.save(true)).not.toThrow();
  });
});
