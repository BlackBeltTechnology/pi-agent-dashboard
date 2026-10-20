/**
 * Tests for `POST /api/file/write-binary` — the plugin file-handler save road.
 * E12–E19, E21–E23, X4–X6, P1 (measure-only). E20 (`registerFileValidator`
 * scope) lives in dashboard-plugin-runtime `file-validator.test.ts`.
 *
 * See change: add-editor-pane-file-handlers.
 */
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFileValidatorPool, type FileValidatorPool } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { PluginClaim } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { serializeWrite } from "../lib/file-write-lock.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import {
  type FileHandlerDeps,
  type HandlerClaimInfo,
  type HandlerValidatorRef,
  registerFileWriteBinaryRoute,
} from "../routes/file-write-binary-routes.js";

const MiB = 1024 * 1024;
const sha1 = (b: Buffer | string) => createHash("sha1").update(b).digest("hex");

const WORD: PluginClaim = {
  slot: "editor-pane-file-handler",
  component: "H",
  id: "word",
  extensions: [".docx"],
  mode: "edit",
  label: "Word",
  copySuffix: "wordcraft",
};

interface Setup {
  cwds: string[];
  claim?: Partial<PluginClaim> | null;
  enabled?: boolean;
  serverLoaded?: boolean;
  validator?: HandlerValidatorRef;
  pool?: FileValidatorPool;
  logs?: string[];
}

function makeApp(s: Setup): FastifyInstance {
  const app = Fastify({ logger: false });
  const claimInfo: HandlerClaimInfo | undefined =
    s.claim === null ? undefined : { pluginId: "wc", claim: { ...WORD, ...s.claim }, enabled: s.enabled ?? true, serverLoaded: s.serverLoaded ?? true };
  const fileHandlers: FileHandlerDeps = {
    resolveClaim: (key) => (key === "wc/word" ? claimInfo : undefined),
    getValidator: (pluginId, claimId) => (pluginId === "wc" && claimId === "word" ? s.validator : undefined),
    validatorPool: s.pool ?? createFileValidatorPool(),
    log: (l) => s.logs?.push(l),
  };
  registerFileWriteBinaryRoute(app, {
    sessionManager: { listAll: () => s.cwds.map((cwd) => ({ cwd })) },
    networkGuard: async () => undefined,
    fileHandlers,
  });
  app.get("/api/health", async () => ({ ok: true }));
  app.post("/other", async () => ({ ok: true }));
  return app;
}

interface Req {
  cwd: string;
  path: string;
  mode?: "overwrite" | "copy";
  expectSha1?: string | null;
  claim?: string;
  body?: Buffer | string;
  siblingExt?: string;
}
function post(app: FastifyInstance, r: Req) {
  const qs = new URLSearchParams({ cwd: r.cwd, path: r.path, mode: r.mode ?? "overwrite", claim: r.claim ?? "wc/word" });
  if (r.expectSha1) qs.set("expectSha1", r.expectSha1);
  if (r.siblingExt !== undefined) qs.set("siblingExt", r.siblingExt);
  return app.inject({
    method: "POST",
    url: `/api/file/write-binary?${qs}`,
    headers: { "content-type": "application/octet-stream" },
    payload: r.body ?? Buffer.from("NEW"),
  });
}

let cwd: string;
let outside: string;
let app: FastifyInstance | undefined;
const SEED = Buffer.from("OLD-CONTENT");

beforeEach(async () => {
  cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "wb-cwd-")));
  outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "wb-out-")));
  await fsp.writeFile(path.join(cwd, "report.docx"), SEED);
  await fsp.writeFile(path.join(cwd, "notes.md"), "# notes\n");
  await fsp.writeFile(path.join(cwd, "deck.pptx"), "PPTX");
  await fsp.writeFile(path.join(outside, "secret.docx"), "SECRET");
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  await fsp.rm(cwd, { recursive: true, force: true });
  await fsp.rm(outside, { recursive: true, force: true });
});

const read = (p: string) => fsp.readFile(path.join(cwd, p), "utf-8");

describe("#E12 write authorization decision table", () => {
  type Row = { name: string; cwdKnown: boolean; target: string; claim: Partial<PluginClaim> | null; enabled?: boolean; ok: boolean };
  const rows: Row[] = [
    { name: "known + under + enabled edit + claimed → 200", cwdKnown: true, target: "report.docx", claim: {}, ok: true },
    { name: "unknown cwd", cwdKnown: false, target: "report.docx", claim: {}, ok: false },
    { name: ".. escape", cwdKnown: true, target: "../escape.docx", claim: {}, ok: false },
    { name: "symlink outside", cwdKnown: true, target: "outlink.docx", claim: {}, ok: false },
    { name: "claim disabled (plugin off)", cwdKnown: true, target: "report.docx", claim: {}, enabled: false, ok: false },
    { name: "preview-mode claim", cwdKnown: true, target: "report.docx", claim: { mode: "preview" }, ok: false },
    { name: "unknown claim", cwdKnown: true, target: "report.docx", claim: null, ok: false },
    { name: "extension not claimed", cwdKnown: true, target: "deck.pptx", claim: {}, ok: false },
    { name: "text file not claimed", cwdKnown: true, target: "notes.md", claim: {}, ok: false },
  ];
  it.each(rows)("$name", async (row) => {
    await fsp.symlink(path.join(outside, "secret.docx"), path.join(cwd, "outlink.docx"));
    app = makeApp({ cwds: row.cwdKnown ? [cwd] : ["/some/other"], claim: row.claim, enabled: row.enabled });
    const before = await fsp.readFile(path.join(cwd, row.target)).catch(() => null);
    const res = await post(app, { cwd, path: row.target, expectSha1: sha1(SEED) });
    if (row.ok) {
      expect(res.statusCode).toBe(200);
      expect(await read("report.docx")).toBe("NEW");
    } else {
      expect(res.statusCode).toBe(403);
      expect(await fsp.readFile(path.join(cwd, row.target)).catch(() => null)).toEqual(before);
      expect(await fsp.readFile(path.join(outside, "secret.docx"), "utf-8")).toBe("SECRET");
    }
  });

  it("is case-insensitive on the claimed extension (REPORT.DOCX)", async () => {
    await fsp.writeFile(path.join(cwd, "REPORT.DOCX"), SEED);
    app = makeApp({ cwds: [cwd] });
    expect((await post(app, { cwd, path: "REPORT.DOCX", expectSha1: sha1(SEED) })).statusCode).toBe(200);
  });

  it("rejects malformed queries (400) and a non-octet-stream body (415)", async () => {
    app = makeApp({ cwds: [cwd] });
    expect((await post(app, { cwd, path: "report.docx", mode: "copy", claim: "nope", expectSha1: sha1(SEED) })).statusCode).toBe(400);
    const res = await app.inject({
      method: "POST",
      url: `/api/file/write-binary?cwd=${encodeURIComponent(cwd)}&path=report.docx&mode=copy&claim=wc/word`,
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(415);
    const empty = await post(app, { cwd, path: "report.docx", mode: "copy", body: "" });
    expect(empty.statusCode).toBe(400);
    expect(await fsp.readdir(cwd)).not.toContain("report.wordcraft.docx");
  });
});

describe("#E13 symlink to an unclaimed extension", () => {
  it("refuses report.docx → notes.md and leaves notes.md unchanged", async () => {
    await fsp.rm(path.join(cwd, "report.docx"));
    await fsp.symlink(path.join(cwd, "notes.md"), path.join(cwd, "report.docx"));
    app = makeApp({ cwds: [cwd] });
    const res = await post(app, { cwd, path: "report.docx", expectSha1: sha1("# notes\n") });
    expect(res.statusCode).toBe(403);
    expect(await read("notes.md")).toBe("# notes\n");
  });
});

describe("#E14 size cap and body limit (BVA)", () => {
  it("claim maxBytes 40 MiB: −1/exact → 200; +1 → 413; > 128 MiB → body limit", async () => {
    app = makeApp({ cwds: [cwd], claim: { maxBytes: 40 * MiB } });
    let token = sha1(SEED);
    for (const n of [40 * MiB - 1, 40 * MiB]) {
      const body = Buffer.alloc(n, 7);
      const res = await post(app, { cwd, path: "report.docx", expectSha1: token, body });
      expect(res.statusCode, `size ${n}`).toBe(200);
      token = res.json().data.sha1;
      expect(token).toBe(sha1(body));
    }
    const before = sha1(await fsp.readFile(path.join(cwd, "report.docx")));
    const tooBig = await post(app, { cwd, path: "report.docx", expectSha1: token, body: Buffer.alloc(40 * MiB + 1, 7) });
    expect(tooBig.statusCode).toBe(413);
    const huge = await post(app, { cwd, path: "report.docx", expectSha1: token, body: Buffer.alloc(128 * MiB + 1, 7) });
    expect(huge.statusCode).toBe(413);
    expect(sha1(await fsp.readFile(path.join(cwd, "report.docx")))).toBe(before);
  }, 60_000);

  it("a 2 MiB body is accepted here while other routes keep the 1 MiB limit", async () => {
    app = makeApp({ cwds: [cwd] });
    const ok = await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED), body: Buffer.alloc(2 * MiB, 1) });
    expect(ok.statusCode).toBe(200);
    const other = await app.inject({
      method: "POST",
      url: "/other",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ blob: "x".repeat(2 * MiB) }),
    });
    expect(other.statusCode).toBe(413);
  });
});

describe("overwrite conflict semantics", () => {
  it("#E15 content change with a restored mtime is still a conflict (409 + current sha1)", async () => {
    app = makeApp({ cwds: [cwd] });
    const target = path.join(cwd, "report.docx");
    const st = await fsp.stat(target);
    await fsp.writeFile(target, "AGENT-EDIT");
    await fsp.utimes(target, st.atime, st.mtime);
    const res = await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, sha1: sha1("AGENT-EDIT") });
    expect(typeof res.json().mtime).toBe("number");
    expect(await read("report.docx")).toBe("AGENT-EDIT");
  });

  it("#E16 a missing / malformed expectSha1 is 400, never 'skip the check'", async () => {
    app = makeApp({ cwds: [cwd] });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: null })).statusCode).toBe(400);
    expect((await post(app, { cwd, path: "report.docx", expectSha1: "abc" })).statusCode).toBe(400);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
  });

  it("#E17 a deleted file is a 409 without sha1", async () => {
    app = makeApp({ cwds: [cwd] });
    await fsp.rm(path.join(cwd, "report.docx"));
    const res = await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) });
    expect(res.statusCode).toBe(409);
    expect(res.json().sha1).toBeUndefined();
    await expect(fsp.stat(path.join(cwd, "report.docx"))).rejects.toThrow(); // never re-created by overwrite
  });

  it("success returns {path, mtime, sha1} with a cwd-relative path and replaces atomically", async () => {
    await fsp.mkdir(path.join(cwd, "sub"));
    await fsp.writeFile(path.join(cwd, "sub", "a.docx"), SEED);
    app = makeApp({ cwds: [cwd] });
    const res = await post(app, { cwd, path: path.join(cwd, "sub", "a.docx"), expectSha1: sha1(SEED), body: "BYTES" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ path: "sub/a.docx", sha1: sha1("BYTES") });
    expect(data.mtime).toBe((await fsp.stat(path.join(cwd, "sub", "a.docx"))).mtimeMs);
    expect(await read("sub/a.docx")).toBe("BYTES");
    expect((await fsp.readdir(path.join(cwd, "sub"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("#E18 file mode", () => {
  it.skipIf(process.getuid?.() === 0)("a failed write is a 500 with a generic message (no absolute path leaks)", async () => {
    app = makeApp({ cwds: [cwd] });
    await fsp.chmod(cwd, 0o555); // tmp file cannot be created next to the target
    try {
      const res = await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("write failed");
      expect(res.body).not.toContain(cwd);
    } finally {
      await fsp.chmod(cwd, 0o755);
    }
  });

  it("overwrite preserves a 0600 mode", async () => {
    app = makeApp({ cwds: [cwd] });
    await fsp.chmod(path.join(cwd, "report.docx"), 0o600);
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) })).statusCode).toBe(200);
    expect((await fsp.stat(path.join(cwd, "report.docx"))).mode & 0o777).toBe(0o600);
  });

  it("copy takes the source mode; a deleted source gets 0644 & ~umask", async () => {
    app = makeApp({ cwds: [cwd] });
    await fsp.chmod(path.join(cwd, "report.docx"), 0o600);
    expect((await post(app, { cwd, path: "report.docx", mode: "copy" })).statusCode).toBe(200);
    expect((await fsp.stat(path.join(cwd, "report.wordcraft.docx"))).mode & 0o777).toBe(0o600);

    await fsp.rm(path.join(cwd, "report.docx"));
    const umask = process.umask();
    expect((await post(app, { cwd, path: "report.docx", mode: "copy" })).statusCode).toBe(200);
    expect((await fsp.stat(path.join(cwd, "report.wordcraft-2.docx"))).mode & 0o777).toBe(0o644 & ~umask);
  });
});

describe("#E19 copy naming", () => {
  it("first free name: stem.suffix.ext, then -2 … -99, never overwriting; 409 when none", async () => {
    app = makeApp({ cwds: [cwd] });
    const first = await post(app, { cwd, path: "report.docx", mode: "copy", body: "C1" });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ path: "report.wordcraft.docx", sha1: sha1("C1") });
    const second = await post(app, { cwd, path: "report.docx", mode: "copy", body: "C2" });
    expect(second.json().data.path).toBe("report.wordcraft-2.docx");
    expect(await read("report.wordcraft.docx")).toBe("C1");

    for (let n = 3; n <= 99; n++) await fsp.writeFile(path.join(cwd, `report.wordcraft-${n}.docx`), `E${n}`);
    const full = await post(app, { cwd, path: "report.docx", mode: "copy", body: "C100" });
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/no free name/);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
    expect(await read("report.wordcraft-99.docx")).toBe("E99");
  });

  it("concurrent copies create distinct files", async () => {
    app = makeApp({ cwds: [cwd] });
    const results = await Promise.all([1, 2, 3, 4].map((i) => post(app as FastifyInstance, { cwd, path: "report.docx", mode: "copy", body: `P${i}` })));
    const paths = results.map((r) => r.json().data.path);
    expect(new Set(paths).size).toBe(4);
    for (const r of results) expect(r.statusCode).toBe(200);
    for (const [i, p] of paths.entries()) expect(await read(p)).toBe(`P${i + 1}`);
  });

  it("keeps the requested extension case and does not need expectSha1", async () => {
    await fsp.writeFile(path.join(cwd, "REPORT.DOCX"), SEED);
    app = makeApp({ cwds: [cwd] });
    const res = await post(app, { cwd, path: "REPORT.DOCX", mode: "copy" });
    expect(res.json().data.path).toBe("REPORT.wordcraft.DOCX");
  });

  it("refuses to copy into a directory that escapes the cwd via symlink", async () => {
    await fsp.symlink(outside, path.join(cwd, "linkdir"));
    app = makeApp({ cwds: [cwd] });
    const res = await post(app, { cwd, path: "linkdir/secret.docx", mode: "copy" });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readdir(outside)).toEqual(["secret.docx"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Native-format sibling copies (change: extend-craft-web-to-all-apps D6; test-plan E17, E18, X4, E22)
// ---------------------------------------------------------------------------------------------------

const RASTER: Partial<PluginClaim> = { id: "word", extensions: [".jpg"], siblingExtensions: [".psd"], copySuffix: "photocraft" };
const PHOTO = Buffer.from("JPEG-BYTES");

describe("E17 core sibling copy", () => {
  beforeEach(async () => {
    await fsp.writeFile(path.join(cwd, "photo.jpg"), PHOTO);
  });

  it("first free <stem><ext>, then <stem>-2<ext>; photo.jpg untouched; the validator receives the sibling ext", async () => {
    const seen: string[] = [];
    const pool = { run: async (j: { ext: string; bytes: Buffer }) => (seen.push(j.ext), { kind: "ok" as const, bytes: j.bytes }) };
    app = makeApp({ cwds: [cwd], claim: RASTER, validator: { moduleUrl: "x" }, pool: pool as never });
    const a = await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd", body: "PSD1" });
    expect(a.statusCode).toBe(200);
    expect(a.json().data.path).toBe("photo.psd");
    const b = await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd", body: "PSD2" });
    expect(b.json().data.path).toBe("photo-2.psd");
    expect(await read("photo.psd")).toBe("PSD1");
    expect(await fsp.readFile(path.join(cwd, "photo.jpg"))).toEqual(PHOTO);
    expect(seen).toEqual([".psd", ".psd"]);
  });

  it("409 when photo.psd … photo-99.psd are all taken", async () => {
    app = makeApp({ cwds: [cwd], claim: RASTER });
    await fsp.writeFile(path.join(cwd, "photo.psd"), "E1");
    for (let n = 2; n <= 99; n++) await fsp.writeFile(path.join(cwd, `photo-${n}.psd`), `E${n}`);
    const res = await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd" });
    expect(res.statusCode).toBe(409);
    expect(await fsp.readFile(path.join(cwd, "photo.jpg"))).toEqual(PHOTO);
  });

  it("an extension outside siblingExtensions → 403; overwrite + siblingExt → 400; malformed → 400; nothing written", async () => {
    app = makeApp({ cwds: [cwd], claim: RASTER });
    expect((await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".exe" })).statusCode).toBe(403);
    expect((await post(app, { cwd, path: "photo.jpg", mode: "overwrite", expectSha1: sha1(PHOTO), siblingExt: ".psd" })).statusCode).toBe(400);
    expect((await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: "psd" })).statusCode).toBe(400);
    expect((await fsp.readdir(cwd)).filter((f) => f.startsWith("photo"))).toEqual(["photo.jpg"]);
    expect(await fsp.readFile(path.join(cwd, "photo.jpg"))).toEqual(PHOTO);
  });

  it("a claim without siblingExtensions refuses any siblingExt (403)", async () => {
    app = makeApp({ cwds: [cwd], claim: { ...RASTER, siblingExtensions: undefined } });
    expect((await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd" })).statusCode).toBe(403);
  });

  it("concurrent sibling copies create distinct files", async () => {
    app = makeApp({ cwds: [cwd], claim: RASTER });
    const rs = await Promise.all([1, 2, 3].map((i) => post(app as FastifyInstance, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd", body: `P${i}` })));
    expect(new Set(rs.map((r) => r.json().data.path)).size).toBe(3);
  });
});

describe("E18 sibling containment", () => {
  it("a tab file that is a symlink to a file outside the cwd → refused; nothing written inside or outside", async () => {
    await fsp.writeFile(path.join(outside, "secret.jpg"), "OUT");
    await fsp.symlink(path.join(outside, "secret.jpg"), path.join(cwd, "photo.jpg"));
    app = makeApp({ cwds: [cwd], claim: RASTER });
    const res = await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd" });
    expect(res.statusCode).toBe(403);
    expect((await fsp.readdir(cwd)).filter((f) => f.endsWith(".psd"))).toEqual([]);
    expect((await fsp.readdir(outside)).sort()).toEqual(["secret.docx", "secret.jpg"]);
  });
});

describe("X4 validator rejects a sibling", () => {
  it("422; no photo*.psd created", async () => {
    await fsp.writeFile(path.join(cwd, "photo.jpg"), PHOTO);
    const pool = { run: async () => ({ kind: "rejected" as const, reason: "not a PSD" }) };
    app = makeApp({ cwds: [cwd], claim: RASTER, validator: { moduleUrl: "x" }, pool: pool as never });
    const res = await post(app, { cwd, path: "photo.jpg", mode: "copy", siblingExt: ".psd" });
    expect(res.statusCode).toBe(422);
    expect((await fsp.readdir(cwd)).filter((f) => f.endsWith(".psd"))).toEqual([]);
  });
});

describe("E22 size caps (claim maxBytes, BVA)", () => {
  it.each([
    [".docx", 40 * MiB],
    [".svg", 16 * MiB],
  ])("%s at the cap passes the size check; cap+1 → 413", async (ext, cap) => {
    await fsp.writeFile(path.join(cwd, `doc${ext}`), "X");
    app = makeApp({ cwds: [cwd], claim: { extensions: [ext], maxBytes: cap } });
    const at = await post(app, { cwd, path: `doc${ext}`, mode: "copy", body: Buffer.alloc(cap, 1) });
    expect(at.statusCode).toBe(200);
    const over = await post(app, { cwd, path: `doc${ext}`, mode: "copy", body: Buffer.alloc(cap + 1, 1) });
    expect(over.statusCode).toBe(413);
  });
});

describe("#E21 validator fail-closed", () => {
  let moduleDir: string;
  const okValidator = async (): Promise<HandlerValidatorRef> => {
    const f = path.join(moduleDir, "ok.mjs");
    await fsp.writeFile(f, "export function validate(){ return {ok:true}; }");
    return { moduleUrl: pathToFileURL(f).href };
  };
  beforeEach(async () => {
    moduleDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wb-val-"));
  });
  afterEach(() => fsp.rm(moduleDir, { recursive: true, force: true }));

  it("registered validator runs and the save succeeds", async () => {
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: await okValidator() });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) })).statusCode).toBe(200);
  });

  it("validator:true but plugin enabled without its server entry loaded → 503, file unchanged", async () => {
    app = makeApp({ cwds: [cwd], claim: { validator: true }, serverLoaded: false });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) })).statusCode).toBe(503);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
  });

  it("validator:true, entry loaded but nothing registered → 503", async () => {
    app = makeApp({ cwds: [cwd], claim: { validator: true }, serverLoaded: true });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) })).statusCode).toBe(503);
  });

  it("enabled() false → 403; enabled() true / throwing", async () => {
    const base = await okValidator();
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { ...base, enabled: () => false } });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) })).statusCode).toBe(403);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
    await app.close();
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { ...base, enabled: () => true } });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) })).statusCode).toBe(200);
    await app.close();
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { ...base, enabled: () => { throw new Error("x"); } } });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1("NEW") })).statusCode).toBe(403);
  });

  it("#X6 validator reject → 422 and the file is unchanged", async () => {
    const f = path.join(moduleDir, "no.mjs");
    await fsp.writeFile(f, "export function validate(){ return {ok:false, reason:'not a docx'}; }");
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { moduleUrl: pathToFileURL(f).href } });
    const res = await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/not a docx/);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
  });

  it("validator sees the bytes and the lower-case extension", async () => {
    const f = path.join(moduleDir, "pick.mjs");
    await fsp.writeFile(f, "export function validate(b, ext){ return ext === '.docx' && Buffer.from(b).toString() === 'NEW' ? {ok:true} : {ok:false, reason:'bad input'}; }");
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { moduleUrl: pathToFileURL(f).href } });
    expect((await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED), body: "NEW" })).statusCode).toBe(200);
  });

  it("#X4 a hanging validator → 422 after ≈5 s; /api/health stays under 200 ms; file unchanged", async () => {
    const f = path.join(moduleDir, "hang.mjs");
    await fsp.writeFile(f, "export function validate(){ while(true){} }");
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { moduleUrl: pathToFileURL(f).href } });
    const t0 = Date.now();
    const pending = post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) });
    await new Promise((r) => setTimeout(r, 300));
    const h0 = Date.now();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(Date.now() - h0).toBeLessThan(200);
    const res = await pending;
    expect(res.statusCode).toBe(422);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4900);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
  }, 20_000);

  it("#X5 2 busy + 8 queued: the 11th save is 503 (busy), the rest time out as 422", async () => {
    const f = path.join(moduleDir, "hang.mjs");
    await fsp.writeFile(f, "export function validate(){ while(true){} }");
    const pool = createFileValidatorPool({ timeoutMs: 300 });
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { moduleUrl: pathToFileURL(f).href }, pool });
    const results = await Promise.all(
      Array.from({ length: 11 }, () => post(app as FastifyInstance, { cwd, path: "report.docx", expectSha1: sha1(SEED) })),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 503)).toHaveLength(1);
    expect(codes.filter((c) => c === 422)).toHaveLength(10);
    expect(await read("report.docx")).toBe("OLD-CONTENT");
    await pool.dispose();
  }, 20_000);
});

describe("#E22 route tier", () => {
  it("ROUTE_TIERS lists POST /api/file/write-binary as control", () => {
    expect(routeTier("POST", "/api/file/write-binary")).toBe("control");
  });

  it("a non-loopback observe bearer is refused (403 insufficient_scope), a control bearer is not tier-refused", async () => {
    const reg = new PairedDeviceRegistry(path.join(cwd, "paired.json"));
    const observe = reg.add("o", "manual", "observe").token;
    const control = reg.add("c", "manual", "control").token;
    const gated = Fastify();
    await gated.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
    gated.decorateRequest("isAuthenticated", false);
    registerBearerAuth(gated, { registry: reg });
    gated.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
    const guard = createNetworkGuard(() => []);
    gated.addHook("preHandler", guard);
    registerFileWriteBinaryRoute(gated, { sessionManager: { listAll: () => [{ cwd }] }, networkGuard: async () => undefined });
    await gated.ready();
    app = gated;
    const call = (token: string) =>
      gated.inject({
        method: "POST",
        url: `/api/file/write-binary?cwd=${encodeURIComponent(cwd)}&path=report.docx&mode=copy&claim=wc/word`,
        remoteAddress: "203.0.113.5",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
        payload: "x",
      });
    const refused = await call(observe);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: "insufficient_scope", scope: "control" });
    expect(await fsp.readdir(cwd)).not.toContain("report.wordcraft.docx");
    expect((await call(control)).statusCode).toBe(403); // passes the tier gate; refused later: no claim registered
    expect((await call(control)).json().error).toMatch(/enabled edit claim/);
  });
});

describe("#E23 lock key = realpath", () => {
  it("concurrent overwrites via an alias and the real path serialize (second sees the first's sha1 → 409)", async () => {
    await fsp.symlink(path.join(cwd, "report.docx"), path.join(cwd, "alias.docx"));
    app = makeApp({ cwds: [cwd] });
    const [a, b] = await Promise.all([
      post(app, { cwd, path: "alias.docx", expectSha1: sha1(SEED), body: "VIA-ALIAS" }),
      post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED), body: "VIA-REAL" }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const winner = a.statusCode === 200 ? "VIA-ALIAS" : "VIA-REAL";
    const loser = a.statusCode === 200 ? b : a;
    expect(loser.json().sha1).toBe(sha1(winner));
    expect(await read("report.docx")).toBe(winner);
    expect((await fsp.lstat(path.join(cwd, "alias.docx"))).isSymbolicLink()).toBe(true); // alias intact
  });

  it("a text-route lock held on the realpath blocks a binary overwrite via the alias", async () => {
    await fsp.symlink(path.join(cwd, "report.docx"), path.join(cwd, "alias.docx"));
    app = makeApp({ cwds: [cwd] });
    let release!: () => void;
    const held = serializeWrite(path.join(cwd, "report.docx"), () => new Promise<void>((r) => (release = r)));
    let settled = false;
    const pending = post(app, { cwd, path: "alias.docx", expectSha1: sha1(SEED) }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(settled).toBe(false);
    release();
    await held;
    expect((await pending).statusCode).toBe(200);
  });
});

describe("observability (task 2.6)", () => {
  it("logs one counts-only line per outcome with a cwd-relative path", async () => {
    const logs: string[] = [];
    app = makeApp({ cwds: [cwd], logs });
    await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED), body: "12345" }); // ok
    await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) }); // conflict
    await post(app, { cwd, path: "notes.md", expectSha1: sha1(SEED) }); // refused
    expect(logs).toHaveLength(3);
    expect(logs[0]).toMatch(/outcome=ok .*claim=wc\/word mode=overwrite bytes=5 path=report\.docx/);
    expect(logs[1]).toMatch(/outcome=conflict .*conflict=changed/);
    expect(logs[2]).toMatch(/outcome=refused-403/);
    expect(logs.join("\n")).not.toContain(cwd);
  });

  it("logs a validator rejection / timeout outcome", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wb-log-"));
    const f = path.join(dir, "no.mjs");
    await fsp.writeFile(f, "export function validate(){ return {ok:false, reason:'x'}; }");
    const logs: string[] = [];
    app = makeApp({ cwds: [cwd], claim: { validator: true }, validator: { moduleUrl: pathToFileURL(f).href }, logs });
    await post(app, { cwd, path: "report.docx", expectSha1: sha1(SEED) });
    expect(logs[0]).toMatch(/refused-422 .*validator=rejected/);
    await fsp.rm(dir, { recursive: true, force: true });
  });
});

describe("#P1 write-binary tail latency (measure-only, never fails)", () => {
  it.skipIf(!process.env.PI_PERF)("20 sequential 40 MiB overwrites with a no-op worker validator", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wb-p1-"));
    const f = path.join(dir, "noop.mjs");
    await fsp.writeFile(f, "export function validate(){ return {ok:true}; }");
    app = makeApp({ cwds: [cwd], claim: { validator: true, maxBytes: 64 * MiB }, validator: { moduleUrl: pathToFileURL(f).href } });
    const body = Buffer.alloc(40 * MiB, 3);
    let token = sha1(SEED);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const res = await post(app, { cwd, path: "report.docx", expectSha1: token, body });
      times.push(performance.now() - t);
      token = res.json().data?.sha1 ?? token;
    }
    times.sort((a, b) => a - b);
    console.info(`[P1] write-binary 40 MiB p95=${times[Math.floor(times.length * 0.95) - 1].toFixed(0)}ms max=${times[19].toFixed(0)}ms`);
    await fsp.rm(dir, { recursive: true, force: true });
  }, 300_000);
});
