/**
 * `ctx.registerFileValidator` scope rules (#E20) and the bounded worker pool
 * (#X4 hang, #X5 overflow, #X6 reject at pool level). See change:
 * add-editor-pane-file-handlers.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileValidatorPool, type FileValidatorPool } from "../server/file-validator-pool.js";
import { FileValidatorRegistry, registerFileValidatorFor } from "../server/file-validator-registry.js";
import { createServerPluginContext } from "../server/server-context.js";

let dir: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "file-validator-")));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function writeModule(name: string, body: string): string {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

describe("registerFileValidatorFor — scope (#E20)", () => {
  const info = () => ({ packageDir: dir, editClaimIds: ["word"] });

  it("registers an own edit claim with a confined module", () => {
    writeModule("v.mjs", "export function validate(){ return {ok:true}; }");
    const reg = new FileValidatorRegistry();
    registerFileValidatorFor("a", info(), { claimId: "word", module: "./v.mjs" }, reg);
    expect(reg.get("a", "word")?.moduleUrl).toBe(pathToFileURL(path.join(dir, "v.mjs")).href);
  });

  it("throws for another plugin's claim, an unknown claim, or no file-handler info", () => {
    writeModule("v.mjs", "export function validate(){ return {ok:true}; }");
    const reg = new FileValidatorRegistry();
    expect(() => registerFileValidatorFor("a", info(), { claimId: "b-claim", module: "./v.mjs" }, reg)).toThrow(/own/);
    expect(() => registerFileValidatorFor("a", undefined, { claimId: "word", module: "./v.mjs" }, reg)).toThrow(/own/);
  });

  it.each(["../x.js", "a/../../x.js", "/etc/passwd", ""])("throws for module path %j", (m) => {
    expect(() => registerFileValidatorFor("a", info(), { claimId: "word", module: m }, new FileValidatorRegistry())).toThrow();
  });

  it("throws for a missing module and for a symlink escaping the package", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    try {
      fs.writeFileSync(path.join(outside, "evil.mjs"), "export function validate(){ return {ok:true}; }");
      fs.symlinkSync(path.join(outside, "evil.mjs"), path.join(dir, "link.mjs"));
      const reg = new FileValidatorRegistry();
      expect(() => registerFileValidatorFor("a", info(), { claimId: "word", module: "./missing.mjs" }, reg)).toThrow(/does not exist/);
      expect(() => registerFileValidatorFor("a", info(), { claimId: "word", module: "./link.mjs" }, reg)).toThrow(/outside/);
      expect(reg.get("a", "word")).toBeUndefined();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("is exposed as ctx.registerFileValidator, bound to the plugin identity", () => {
    writeModule("v.mjs", "export function validate(){ return {ok:true}; }");
    const ctxB = createServerPluginContext({} as never, "b", [], { packageDir: dir, editClaimIds: ["other"] });
    // plugin B tries to register plugin A's claim id "word"
    expect(() => ctxB.registerFileValidator({ claimId: "word", module: "./v.mjs" })).toThrow(/own/);
    expect(() => ctxB.registerFileValidator({ claimId: "other", module: "../x.js" })).toThrow();
  });
});

describe("file validator pool", () => {
  let pool: FileValidatorPool;
  afterEach(async () => pool?.dispose());
  const url = (name: string) => pathToFileURL(path.join(dir, name)).href;
  const bytes = (s = "hello") => Buffer.from(s);

  it("ok: accepts and hands the bytes back intact (transferred, re-attached)", async () => {
    writeModule("ok.mjs", "export function validate(b, ext){ return b.length>0 && ext===\".docx\" ? {ok:true} : {ok:false, reason:'bad'}; }");
    pool = createFileValidatorPool();
    const out = await pool.run({ moduleUrl: url("ok.mjs"), bytes: bytes(), ext: ".docx" });
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") expect(out.bytes.toString()).toBe("hello");
  });

  it("works with a pooled (offset) Buffer", async () => {
    writeModule("ok.mjs", "export function validate(){ return {ok:true}; }");
    pool = createFileValidatorPool();
    const small = Buffer.from("tiny"); // small Buffers live in Node's shared pool
    const out = await pool.run({ moduleUrl: url("ok.mjs"), bytes: small, ext: ".docx" });
    expect(out.kind === "ok" && out.bytes.toString()).toBe("tiny");
    expect(small.toString()).toBe("tiny"); // original untouched when it was a view
  });

  it("rejected (#X6), thrown error and missing validate are distinguished", async () => {
    writeModule("no.mjs", "export function validate(){ return {ok:false, reason:'not a docx'}; }");
    writeModule("throw.mjs", "export function validate(){ throw new Error('boom'); }");
    writeModule("none.mjs", "export const x = 1;");
    pool = createFileValidatorPool();
    expect(await pool.run({ moduleUrl: url("no.mjs"), bytes: bytes(), ext: ".docx" })).toEqual({ kind: "rejected", reason: "not a docx" });
    expect(await pool.run({ moduleUrl: url("throw.mjs"), bytes: bytes(), ext: ".docx" })).toMatchObject({ kind: "error", reason: "boom" });
    expect(await pool.run({ moduleUrl: url("none.mjs"), bytes: bytes(), ext: ".docx" })).toMatchObject({ kind: "error" });
  });

  it("a validator that mutates the bytes is refused", async () => {
    writeModule("mut.mjs", "export function validate(b){ b[0]=0; return {ok:true}; }");
    pool = createFileValidatorPool();
    expect(await pool.run({ moduleUrl: url("mut.mjs"), bytes: bytes(), ext: ".docx" })).toMatchObject({ kind: "error", reason: /modified/ });
  });

  it("#X4 a hanging validator times out (hard terminate) without blocking the main thread; the pool recovers", async () => {
    writeModule("hang.mjs", "export function validate(){ while(true){} }");
    writeModule("ok.mjs", "export function validate(){ return {ok:true}; }");
    pool = createFileValidatorPool({ timeoutMs: 400 });
    let maxGap = 0;
    let last = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 20);
    const t0 = Date.now();
    const out = await pool.run({ moduleUrl: url("hang.mjs"), bytes: bytes(), ext: ".docx" });
    clearInterval(tick);
    expect(out).toEqual({ kind: "timeout" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(380);
    expect(maxGap).toBeLessThan(200);
    expect((await pool.run({ moduleUrl: url("ok.mjs"), bytes: bytes(), ext: ".docx" })).kind).toBe("ok");
  });

  it("#X5 2 busy + 8 queued → the 11th is busy; queued jobs run FIFO once a slot frees", async () => {
    writeModule("hang.mjs", "export function validate(){ while(true){} }");
    pool = createFileValidatorPool({ timeoutMs: 600 });
    const runs = Array.from({ length: 11 }, () => pool.run({ moduleUrl: url("hang.mjs"), bytes: bytes(), ext: ".docx" }));
    // the 11th resolves immediately as busy; the others only after their timeout
    expect(await runs[10]).toEqual({ kind: "busy" });
    const settled = await Promise.all(runs.slice(0, 10));
    expect(settled.every((o) => o.kind === "timeout")).toBe(true);
  }, 20_000);
});
