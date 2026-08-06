/**
 * Dedicated durable canonical `invoice → sessionId` store (Decision 1, Option B).
 * Keyed by `cwd\0invoiceId`; persists to a JSON file so the canonical link
 * survives a dashboard restart. See change: make-invoice-session-canonical.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCanonicalSessionStore } from "../canonical-session-store.js";

const CWD = "/work/acme";
let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ib-canon-store-"));
  file = join(dir, "canonical-sessions.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("createCanonicalSessionStore", () => {
  it("returns undefined for an unknown invoice", () => {
    const store = createCanonicalSessionStore(file);
    expect(store.get(CWD, "inv-1")).toBeUndefined();
  });

  it("set then get returns the recorded session id", () => {
    const store = createCanonicalSessionStore(file);
    store.set(CWD, "inv-1", "sess-1");
    expect(store.get(CWD, "inv-1")).toBe("sess-1");
  });

  it("persists across instances — a fresh store reads the id from disk (restart)", () => {
    const a = createCanonicalSessionStore(file);
    a.set(CWD, "inv-1", "sess-1");
    expect(existsSync(file)).toBe(true);

    // Simulate a dashboard restart: a brand-new instance, in-memory state gone.
    const b = createCanonicalSessionStore(file);
    expect(b.get(CWD, "inv-1")).toBe("sess-1");
  });

  it("re-point overwrites the id and persists the new value", () => {
    const a = createCanonicalSessionStore(file);
    a.set(CWD, "inv-1", "sess-old");
    a.set(CWD, "inv-1", "sess-new");
    expect(a.get(CWD, "inv-1")).toBe("sess-new");
    expect(createCanonicalSessionStore(file).get(CWD, "inv-1")).toBe("sess-new");
  });

  it("delete removes the entry and persists the removal", () => {
    const a = createCanonicalSessionStore(file);
    a.set(CWD, "inv-1", "sess-1");
    a.delete(CWD, "inv-1");
    expect(a.get(CWD, "inv-1")).toBeUndefined();
    expect(createCanonicalSessionStore(file).get(CWD, "inv-1")).toBeUndefined();
  });

  it("scopes by both cwd and invoiceId", () => {
    const store = createCanonicalSessionStore(file);
    store.set(CWD, "inv-1", "sess-1");
    store.set(CWD, "inv-2", "sess-2");
    store.set("/other", "inv-1", "sess-3");
    expect(store.get(CWD, "inv-1")).toBe("sess-1");
    expect(store.get(CWD, "inv-2")).toBe("sess-2");
    expect(store.get("/other", "inv-1")).toBe("sess-3");
  });

  it("tolerates a missing file (no throw, empty)", () => {
    const store = createCanonicalSessionStore(join(dir, "does", "not", "exist.json"));
    expect(store.get(CWD, "inv-1")).toBeUndefined();
    // and can still record + create the file lazily
    store.set(CWD, "inv-1", "sess-1");
    expect(store.get(CWD, "inv-1")).toBe("sess-1");
  });

  it("tolerates a corrupt file (no throw, empty)", () => {
    writeFileSync(file, "{not json");
    const store = createCanonicalSessionStore(file);
    expect(store.get(CWD, "inv-1")).toBeUndefined();
    store.set(CWD, "inv-1", "sess-1");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ [`${CWD}\u0000inv-1`]: "sess-1" });
  });
});
