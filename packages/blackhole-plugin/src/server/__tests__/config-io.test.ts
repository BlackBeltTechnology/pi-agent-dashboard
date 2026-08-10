/**
 * L1 — read/write semantics of the config file: absent file (E16), defaults
 * reporting (E17), registry-independence (E22), fail-closed parse (X1, X2),
 * unknown/annotation-key survival (X4, X5), key order (X6), request-time re-read
 * (X7), atomic write under concurrent reads (X8), interleaved external write
 * (X9), and an unwritable directory (X11).
 *
 * See change: add-blackhole-plugin.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigParseErrorOnWrite, readConfig, saveConfig } from "../config-io.js";

/**
 * One-shot hook fired right after any `readFileSync`, so a test can land an
 * external write INSIDE `saveConfig`'s read→write merge window (X9). ESM module
 * namespaces are not configurable, so `vi.spyOn(fs, …)` cannot do this — the
 * module has to be mocked at import time.
 */
const hooks = vi.hoisted(() => ({ afterRead: null as null | (() => void) }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    readFileSync: (p: Parameters<typeof actual.readFileSync>[0], o?: unknown) => {
      const out = actual.readFileSync(p, o as never);
      const hook = hooks.afterRead;
      if (hook) {
        hooks.afterRead = null;
        hook();
      }
      return out;
    },
  };
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "blackhole-io-"));
  file = path.join(dir, "pi-blackhole", "pi-blackhole-config.json");
});

afterEach(() => {
  hooks.afterRead = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

function readBack(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

describe("absent file (E16, E22)", () => {
  it("returns defaults with exists=false and does NOT create the file", () => {
    const res = readConfig(file);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.exists).toBe(false);
    expect(res.fields.observeAfterTokens).toEqual({ value: 15_000, default: 15_000, isDefault: true });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reports no unmanaged keys for an absent file", () => {
    const res = readConfig(file);
    expect(res.status === "ok" && res.unmanagedKeys).toEqual([]);
  });
});

describe("values absent from the file report as defaults (E17)", () => {
  it("marks an omitted key not-user-set and reports the built-in default", () => {
    write(JSON.stringify({ compaction: "manual" }));
    const res = readConfig(file);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.fields.observeAfterTokens).toEqual({ value: 15_000, default: 15_000, isDefault: true });
    expect(res.fields.compaction).toEqual({ value: "manual", default: "auto", isDefault: false });
  });

  it("reports the unmanaged keys present in the file", () => {
    write(JSON.stringify({ _comment: "hi", dropperPoolFullnessThreshold: 0.2, memory: true }));
    const res = readConfig(file);
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.unmanagedKeys.sort()).toEqual(["_comment", "dropperPoolFullnessThreshold"]);
  });
});

describe("unparseable config fails closed (X1, X2)", () => {
  const MALFORMED = '{\n  "memory": true,\n  "debug": false,\n}\n';

  it("returns a parse-error carrying the parser message and NO config object (X1)", () => {
    write(MALFORMED);
    const res = readConfig(file);
    expect(res.status).toBe("parse-error");
    if (res.status !== "parse-error") return;
    expect(res.message.length).toBeGreaterThan(0);
    expect(res).not.toHaveProperty("fields");
  });

  it("never falls back to defaults on a parse error", () => {
    write(MALFORMED);
    expect(readConfig(file)).not.toHaveProperty("fields");
  });

  it("rejects a non-object JSON root", () => {
    write("[1, 2, 3]");
    expect(readConfig(file).status).toBe("parse-error");
  });

  it("blocks the write and leaves the bytes byte-identical (X2)", () => {
    write(MALFORMED);
    const before = fs.readFileSync(file);
    expect(() => saveConfig(file, { memory: false })).toThrow(ConfigParseErrorOnWrite);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });
});

describe("writes preserve keys the plugin does not manage (X4, X5, X6)", () => {
  it("keeps _comment, _notes and skipForProviders across a save (X4)", () => {
    write(
      JSON.stringify({
        _comment: "hand-written",
        _notes: ["line one", "line two"],
        skipForProviders: ["openai"],
        compactAfterTokens: 81_000,
      }),
    );
    saveConfig(file, { compactAfterTokens: 90_000 });
    const after = readBack();
    expect(after._comment).toBe("hand-written");
    expect(after._notes).toEqual(["line one", "line two"]);
    expect(after.skipForProviders).toEqual(["openai"]);
    expect(after.compactAfterTokens).toBe(90_000);
  });

  it("keeps a real blackhole key absent from our descriptors (X5)", () => {
    write(JSON.stringify({ dropperPoolFullnessThreshold: 0.25, memory: true }));
    saveConfig(file, { memory: false });
    expect(readBack().dropperPoolFullnessThreshold).toBe(0.25);
  });

  it("reports which unmanaged keys it carried over", () => {
    write(JSON.stringify({ _comment: "x", fullFoldAlways: true, memory: true }));
    const res = saveConfig(file, { memory: false });
    expect(res.preservedUnmanagedKeys.sort()).toEqual(["_comment", "fullFoldAlways"]);
  });

  it("retains the original relative key order and appends new keys (X6)", () => {
    write(JSON.stringify({ memory: true, _comment: "z", compaction: "auto", debug: false }));
    saveConfig(file, { compaction: "off", agentMaxTurns: 24 });
    expect(Object.keys(readBack())).toEqual([
      "memory",
      "_comment",
      "compaction",
      "debug",
      "agentMaxTurns",
    ]);
  });

  it("removes a managed key set to undefined (a cleared optional field)", () => {
    write(JSON.stringify({ memory: true, observerModel: { provider: "p", id: "m" } }));
    saveConfig(file, { observerModel: undefined });
    expect(Object.hasOwn(readBack(), "observerModel")).toBe(false);
    expect(readBack().memory).toBe(true);
  });

  it("creates the parent directory when the file is absent", () => {
    saveConfig(file, { memory: false });
    expect(readBack()).toEqual({ memory: false });
  });
});

describe("the merge uses the request's own read (X7)", () => {
  it("does not resurrect content the client loaded before an external change", () => {
    write(JSON.stringify({ memory: true, _comment: "original" }));
    // The client loaded the above. Now an external process rewrites the file
    // BEFORE our request's read.
    write(JSON.stringify({ memory: true, _comment: "changed externally" }));

    saveConfig(file, { memory: false });

    const after = readBack();
    expect(after._comment).toBe("changed externally");
    expect(after.memory).toBe(false);
  });
});

describe("the write is atomic from a reader's perspective (X8)", () => {
  it("never exposes a partial file across 200 save iterations", () => {
    write(JSON.stringify({ memory: true, _notes: "x".repeat(20_000) }));
    let reads = 0;
    for (let i = 0; i < 200; i++) {
      saveConfig(file, { agentMaxTurns: i + 1 });
      // A reader looping alongside the saves must always parse.
      const text = fs.readFileSync(file, "utf-8");
      expect(() => JSON.parse(text)).not.toThrow();
      reads++;
    }
    expect(reads).toBe(200);
    expect(readBack().agentMaxTurns).toBe(200);
  });

  it("leaves no temp file behind after a successful write", () => {
    saveConfig(file, { memory: true });
    const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("an interleaved external write is not reported as merged (X9)", () => {
  it("omits an externally-added key from preservedUnmanagedKeys and flags the race", () => {
    write(JSON.stringify({ memory: true, _comment: "before" }));

    // Land the external write INSIDE the save's merge window — after its read,
    // before its write — by hooking the read the save itself performs.
    hooks.afterRead = () => {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
      parsed.externallyAdded = "landed mid-save";
      fs.writeFileSync(file, JSON.stringify(parsed), "utf-8");
    };
    const res = saveConfig(file, { memory: false });

    expect(res.preservedUnmanagedKeys).not.toContain("externallyAdded");
    expect(res.externalWriteDetected).toBe(true);
    // And the honest outcome: the external key really was lost, so nothing in
    // the report may imply otherwise.
    expect(Object.hasOwn(readBack(), "externallyAdded")).toBe(false);
  });

  it("reports no race when nothing else writes", () => {
    write(JSON.stringify({ memory: true }));
    expect(saveConfig(file, { memory: false }).externalWriteDetected).toBe(false);
  });
});

describe("an unwritable agent directory surfaces an error (X11)", () => {
  it("throws and leaves no partial file behind", () => {
    const locked = path.join(dir, "locked");
    fs.mkdirSync(locked);
    const target = path.join(locked, "pi-blackhole-config.json");
    fs.writeFileSync(target, JSON.stringify({ memory: true }), "utf-8");
    const before = fs.readFileSync(target);
    fs.chmodSync(locked, 0o500);
    try {
      expect(() => saveConfig(target, { memory: false })).toThrow();
      expect(fs.readFileSync(target).equals(before)).toBe(true);
      expect(fs.readdirSync(locked).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });
});
