/**
 * Durable per-question files (test-plan #E23, tasks 4.4). One file per
 * question avoids read-modify-write races. See change: add-pending-question-stack (D6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQuestionFileStore, type QuestionFile } from "../question-files.js";

const ID_A = "AAAAAAAAAAAAAAAAAAAAAA";
const ID_B = "BBBBBBBBBBBBBBBBBBBBBB";
const ID_C = "CCCCCCCCCCCCCCCCCCCCCC";

function file(id: string, sessionId: string, promptId = "p1", extra: Partial<QuestionFile> = {}): QuestionFile {
  return {
    version: 1,
    id,
    sessionId,
    promptId,
    askedAt: 1000,
    snapshot: { toolCalls: [], redactionVersion: 1, assistantAbsentReason: "none" },
    briefStatus: "pending",
    ...extra,
  };
}

describe("question file store", () => {
  let home: string;
  let origHome: string | undefined;
  beforeEach(() => {
    origHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "qfiles-"));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const dir = () => path.join(home, ".pi", "dashboard", "questions");

  it("defaults to ~/.pi/dashboard/questions (HOME-redirectable)", () => {
    const store = createQuestionFileStore();
    expect(store.dir).toBe(dir());
  });

  it("writes <id>.json with mode 0600 and leaves no temp file behind", () => {
    const store = createQuestionFileStore();
    store.write(file(ID_A, "s1"));
    expect(fs.readdirSync(dir())).toEqual([`${ID_A}.json`]);
    expect(fs.statSync(path.join(dir(), `${ID_A}.json`)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(path.join(dir(), `${ID_A}.json`), "utf8"))).toMatchObject({ id: ID_A, sessionId: "s1", promptId: "p1" });
  });

  it("an overwrite replaces atomically and keeps mode 0600", () => {
    const store = createQuestionFileStore();
    store.write(file(ID_A, "s1"));
    store.write(file(ID_A, "s1", "p1", { briefStatus: "ready", brief: "hello" }));
    expect(fs.readdirSync(dir())).toEqual([`${ID_A}.json`]);
    expect(store.loadAll()[0]).toMatchObject({ briefStatus: "ready", brief: "hello" });
    expect(fs.statSync(path.join(dir(), `${ID_A}.json`)).mode & 0o777).toBe(0o600);
  });

  it("loadAll round-trips and skips corrupt / mismatched / foreign files", () => {
    const store = createQuestionFileStore();
    store.write(file(ID_A, "s1"));
    fs.writeFileSync(path.join(dir(), `${ID_B}.json`), "{not json");
    fs.writeFileSync(path.join(dir(), `${ID_C}.json`), JSON.stringify(file(ID_A, "s9"))); // id ≠ basename
    fs.writeFileSync(path.join(dir(), "notes.txt"), "x");
    expect(store.loadAll().map((f) => f.id)).toEqual([ID_A]);
  });

  it("loadAll on a missing directory is empty", () => {
    expect(createQuestionFileStore().loadAll()).toEqual([]);
  });

  it("remove deletes the file and is idempotent", () => {
    const store = createQuestionFileStore();
    store.write(file(ID_A, "s1"));
    store.remove(ID_A);
    store.remove(ID_A);
    expect(fs.existsSync(path.join(dir(), `${ID_A}.json`))).toBe(false);
  });

  it("refuses ids that are not 22-char base64url (no path traversal)", () => {
    const store = createQuestionFileStore();
    expect(() => store.write(file("../../etc/passwd", "s1"))).toThrow();
    expect(() => store.remove("../x")).not.toThrow();
  });

  it("sweep deletes files only for unknown or ended sessions (test-plan #E23)", () => {
    const store = createQuestionFileStore();
    store.write(file(ID_A, "live-reconnecting")); // persisted + not ended
    store.write(file(ID_B, "unknown"));
    store.write(file(ID_C, "ended"));
    const deleted = store.sweep((sid) => (sid === "live-reconnecting" ? "present" : sid === "ended" ? "ended" : "unknown"));
    expect(deleted.sort()).toEqual([ID_B, ID_C].sort());
    expect(fs.readdirSync(dir())).toEqual([`${ID_A}.json`]);
  });
});
