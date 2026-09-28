/**
 * Push token registry: in-memory, write-through at 0600, idempotent by
 * deviceToken, debounced `touch`, corrupt-file quarantine.
 * Harness: json-store.test.ts (tmp dir per test).
 * See change: add-server-push-notifications (test-plan #E27, #E28, #X15, #P3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPushTokenRegistry } from "../push/push-token-registry.js";

describe("push-token-registry", () => {
  let tmpDir: string;
  let file: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-registry-test-"));
    file = path.join(tmpDir, "push-tokens.json");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists across a restart with the same id (test-plan #E27)", () => {
    const a = createPushTokenRegistry({ path: file });
    const res = a.add({ deviceToken: "https://h.example/hook", transport: "webhook", label: "h" });
    expect(res.ok).toBe(true);
    const id = res.ok ? res.token.id : "";

    const b = createPushTokenRegistry({ path: file });
    const listed = b.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(id);
    expect(listed[0].deviceToken).toBe("https://h.example/hook");
    expect(listed[0].label).toBe("h");
  });

  it.skipIf(process.platform === "win32")("writes the file with mode 0600", () => {
    const a = createPushTokenRegistry({ path: file });
    a.add({ deviceToken: "tok", transport: "fcm" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is idempotent by deviceToken: one entry, original id, newer lastUsedAt (test-plan #E28)", () => {
    let t = 1_000;
    const reg = createPushTokenRegistry({ path: file, now: () => t });
    const first = reg.add({ deviceToken: "X", transport: "fcm" });
    t = 5_000;
    const second = reg.add({ deviceToken: "X", transport: "fcm" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.token.id).toBe(first.token.id);
    expect(second.created).toBe(false);
    const listed = reg.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].lastUsedAt).toBe(5_000);
    expect(listed[0].registeredAt).toBe(1_000);
  });

  it("refuses a 51st distinct token but re-registers an existing one at capacity", () => {
    const reg = createPushTokenRegistry({ path: file });
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = reg.add({ deviceToken: `t${i}`, transport: "fcm" });
      if (r.ok) ids.push(r.token.id);
    }
    expect(ids).toHaveLength(50);
    expect(reg.add({ deviceToken: "t50", transport: "fcm" })).toEqual({ ok: false, reason: "capacity" });
    const again = reg.add({ deviceToken: "t7", transport: "fcm" });
    expect(again.ok && again.token.id).toBe(ids[7]);
  });

  it("quarantines a corrupt file, starts empty and records an error (test-plan #X15)", () => {
    fs.writeFileSync(file, "{not json");
    const reg = createPushTokenRegistry({ path: file, now: () => 1234 });
    expect(reg.list()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.corrupt-1234`)).toBe(true);
    expect(fs.readFileSync(`${file}.corrupt-1234`, "utf-8")).toBe("{not json");
    expect(reg.errors.some((e) => /registry/i.test(e))).toBe(true);
    // Still usable afterwards.
    expect(reg.add({ deviceToken: "a", transport: "fcm" }).ok).toBe(true);
  });

  it("matching() honours sessionFilter; absent or empty means all sessions", () => {
    const reg = createPushTokenRegistry({ path: file });
    reg.add({ deviceToken: "all", transport: "fcm" });
    reg.add({ deviceToken: "empty", transport: "fcm", sessionFilter: [] });
    reg.add({ deviceToken: "onlyA", transport: "fcm", sessionFilter: ["A"] });
    expect(reg.matching("B").map((t) => t.deviceToken).sort()).toEqual(["all", "empty"]);
    expect(reg.matching("A").map((t) => t.deviceToken).sort()).toEqual(["all", "empty", "onlyA"]);
  });

  it("consecutiveFailures counts failures in memory and resets on touch", () => {
    const reg = createPushTokenRegistry({ path: file });
    const r = reg.add({ deviceToken: "a", transport: "webhook" });
    if (!r.ok) throw new Error("add failed");
    reg.recordFailure(r.token.id);
    reg.recordFailure(r.token.id);
    expect(reg.consecutiveFailures(r.token.id)).toBe(2);
    reg.touch(r.token.id);
    expect(reg.consecutiveFailures(r.token.id)).toBe(0);
    // Not persisted.
    expect(fs.readFileSync(file, "utf-8")).not.toMatch(/consecutiveFailures/);
  });

  it("remove() drops the token from memory and file and notifies listeners", () => {
    const reg = createPushTokenRegistry({ path: file });
    const r = reg.add({ deviceToken: "a", transport: "webhook" });
    if (!r.ok) throw new Error("add failed");
    const removed: string[] = [];
    reg.onRemove((id) => removed.push(id));
    expect(reg.remove(r.token.id)).toBe(true);
    expect(reg.list()).toEqual([]);
    expect(createPushTokenRegistry({ path: file }).list()).toEqual([]);
    expect(removed).toEqual([r.token.id]);
    expect(reg.remove(r.token.id)).toBe(false);
  });

  it("persists touch at most once per 60 s (test-plan #P3)", () => {
    let t = 0;
    const reg = createPushTokenRegistry({ path: file, now: () => t });
    const r = reg.add({ deviceToken: "a", transport: "webhook" });
    if (!r.ok) throw new Error("add failed");
    const rename = vi.spyOn(fs, "renameSync");
    const writesToFile = () => rename.mock.calls.filter((c) => c[1] === file).length;

    for (let i = 0; i < 20; i++) {
      t = Math.round((i * 59_000) / 19); // 0 … 59 000 ms
      reg.touch(r.token.id);
    }
    expect(writesToFile()).toBe(1);
    t = 61_000;
    reg.touch(r.token.id);
    expect(writesToFile()).toBe(2);
    expect(reg.get(r.token.id)?.lastUsedAt).toBe(61_000);
  });
});
