/**
 * FileHandlerHost — `snapshot()` digest bracket (X1–X3) and `save()` policy:
 * first-overwrite notice (X8), conflict dialog (X7), busy/rejected mapping.
 * See change: add-editor-pane-file-handlers (D3, tasks 4.1/4.2).
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileHandlerHost, type FileHandlerHostDeps } from "../file-handler-host.js";

vi.mock("../../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

const sha = (b: Uint8Array | string) => createHash("sha1").update(b).digest("hex");
const ab = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const digestRes = (content: string, mtime = 1) =>
  new Response(JSON.stringify({ success: true, data: { size: content.length, mtime, sha1: sha(content) } }));
const writeRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Call = { url: URL; init?: RequestInit };
let calls: Call[] = [];
let router: (c: Call) => Response | Promise<Response>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const c = { url, init };
    calls.push(c);
    return router(c);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const META = { id: "docx", extensions: [".docx"], mode: "edit" as const, label: "Edit", copySuffix: "demo" };

function mk(over: Partial<FileHandlerHostDeps> = {}, meta: Partial<typeof META & { maxBytes: number; firstOverwriteNotice: string }> = {}) {
  let token: string | null = null;
  let first = false;
  let dirty: boolean | "unknown" = "unknown";
  const asks: Array<{ title: string; actions: string[] }> = [];
  const answers: Array<string | null> = [];
  const deps: FileHandlerHostDeps = {
    cwd: "/proj",
    path: "report.docx",
    claimKey: "demo/docx",
    meta: { ...META, ...meta },
    getToken: () => token,
    setToken: (t) => {
      token = t;
    },
    firstOverwriteDone: () => first,
    markFirstOverwriteDone: () => {
      first = true;
    },
    getDirty: () => dirty,
    setDirty: (s) => {
      dirty = s;
    },
    ask: async (req) => {
      asks.push({ title: req.title, actions: req.actions.map((a) => a.id) });
      return answers.shift() ?? null;
    },
    guardReload: vi.fn(async () => true),
    remount: vi.fn(),
    setBaseline: vi.fn(),
    trackedWrite: vi.fn(async (send: (s: AbortSignal) => Promise<Response>) => send(new AbortController().signal)),
    notifyCopy: vi.fn(),
    ...over,
  };
  return { host: createFileHandlerHost(deps), deps, asks, answers, token: () => token, isFirst: () => first };
}

const isRaw = (c: Call) => c.url.pathname === "/api/file/raw";
const isDigest = (c: Call) => c.url.pathname === "/api/file/digest";
const isWrite = (c: Call) => c.url.pathname === "/api/file/write-binary";

describe("snapshot()", () => {
  it("returns consistent bytes + sha1 token and baselines the tab (digest bracket)", async () => {
    router = (c) => (isRaw(c) ? new Response("v1") : digestRes("v1"));
    const m = mk();
    const s = await m.host.snapshot();
    expect(new TextDecoder().decode(s.bytes)).toBe("v1");
    expect(s.sha1).toBe(sha("v1"));
    expect(m.token()).toBe(sha("v1"));
    expect(m.deps.setBaseline).toHaveBeenCalledWith(expect.objectContaining({ sha1: sha("v1") }));
    // digest → raw → digest, never /api/file
    expect(calls.map((c) => c.url.pathname)).toEqual(["/api/file/digest", "/api/file/raw", "/api/file/digest"]);
    expect(calls[1].init?.cache).toBe("no-store");
  });

  it("X1: rejects after 3 attempts when digest and bytes never agree", async () => {
    let digests = 0;
    router = (c) => {
      if (isRaw(c)) return new Response("S2");
      digests += 1;
      return digestRes(digests % 2 === 1 ? "S1" : "S2");
    };
    const m = mk();
    await expect(m.host.snapshot()).rejects.toMatchObject({ code: "inconsistent" });
    expect(calls.filter(isRaw)).toHaveLength(3);
    expect(m.token()).toBeNull();
  });

  it("X1b: bytes that do not hash to the second digest are never accepted", async () => {
    router = (c) => (isRaw(c) ? new Response("other") : digestRes("v1"));
    await expect(mk().host.snapshot()).rejects.toMatchObject({ code: "inconsistent" });
  });

  it("X2: a touch (mtime change, equal sha1) resolves on the first attempt", async () => {
    let n = 0;
    router = (c) => (isRaw(c) ? new Response("v1") : digestRes("v1", ++n));
    await expect(mk().host.snapshot()).resolves.toMatchObject({ sha1: sha("v1") });
    expect(calls.filter(isRaw)).toHaveLength(1);
  });

  it("X3: size above the claim maxBytes rejects too-large before any content request", async () => {
    router = (c) => {
      if (isRaw(c)) throw new Error("must not fetch raw");
      return new Response(JSON.stringify({ success: true, data: { size: 101, mtime: 1, sha1: sha("x") } }));
    };
    await expect(mk({}, { maxBytes: 100 }).host.snapshot()).rejects.toMatchObject({ code: "too-large", limit: 100 });
    expect(calls.some(isRaw)).toBe(false);
    expect(calls.some((c) => c.url.pathname === "/api/file")).toBe(false);
  });

  it("rejects unreadable when the digest has no answer", async () => {
    router = () => new Response("{}", { status: 404 });
    await expect(mk().host.snapshot()).rejects.toMatchObject({ code: "unreadable" });
  });
});

const OK = (path = "report.docx", sha1 = sha("new")) => writeRes(200, { success: true, data: { path, mtime: 9, sha1 } });

describe("save() — overwrite", () => {
  it("writes with expectSha1 = last token, tracked, and advances the token", async () => {
    router = (c) => (isRaw(c) ? new Response("v1") : isWrite(c) ? OK() : digestRes("v1"));
    const m = mk();
    await m.host.snapshot();
    const r = await m.host.save(ab("new"), { target: "overwrite" });
    expect(r).toEqual({ ok: true, path: "report.docx", mtime: 9, sha1: sha("new") });
    const w = calls.find(isWrite)!;
    expect(w.url.searchParams.get("mode")).toBe("overwrite");
    expect(w.url.searchParams.get("claim")).toBe("demo/docx");
    expect(w.url.searchParams.get("expectSha1")).toBe(sha("v1"));
    expect(w.url.searchParams.get("cwd")).toBe("/proj");
    expect(new Headers(w.init?.headers).get("content-type")).toBe("application/octet-stream");
    expect(m.deps.trackedWrite).toHaveBeenCalledTimes(1);
    expect(m.token()).toBe(sha("new"));
  });

  it("rejects too-large locally without a request", async () => {
    router = () => {
      throw new Error("no request expected");
    };
    const m = mk({}, { maxBytes: 2 });
    expect(await m.host.save(ab("abc"), { target: "overwrite" })).toMatchObject({ ok: false, reason: "too-large" });
    expect(calls).toHaveLength(0);
  });

  it("without a token (never snapshotted) sends no overwrite", async () => {
    router = () => {
      throw new Error("no request expected");
    };
    expect(await mk().host.save(ab("x"), { target: "overwrite" })).toMatchObject({ ok: false, reason: "rejected" });
  });

  it.each([
    [422, "rejected"],
    [403, "rejected"],
    [413, "too-large"],
    [503, "busy"],
  ])("maps HTTP %i to reason %s", async (status, reason) => {
    router = (c) => (isRaw(c) ? new Response("v1") : isWrite(c) ? writeRes(status, { success: false, error: "nope" }) : digestRes("v1"));
    const m = mk();
    await m.host.snapshot();
    expect(await m.host.save(ab("x"), { target: "overwrite" })).toMatchObject({ ok: false, reason, message: "nope" });
  });

  it("a second concurrent save reports busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    router = async (c) => {
      if (isRaw(c)) return new Response("v1");
      if (isWrite(c)) {
        await gate;
        return OK();
      }
      return digestRes("v1");
    };
    const m = mk();
    await m.host.snapshot();
    const first = m.host.save(ab("a"), { target: "overwrite" });
    expect(await m.host.save(ab("b"), { target: "overwrite" })).toMatchObject({ ok: false, reason: "busy" });
    release();
    expect(await first).toMatchObject({ ok: true });
  });
});

describe("X8 first overwrite notice", () => {
  const notice = { firstOverwriteNotice: "Overwrites the original." };
  const setup = () => {
    router = (c) => (isRaw(c) ? new Response("v1") : isWrite(c) ? OK() : digestRes("v1"));
    return mk({}, notice);
  };

  it("Cancel → cancelled, nothing written; Overwrite → written; third save asks nothing", async () => {
    const m = setup();
    await m.host.snapshot();
    m.answers.push(null);
    expect(await m.host.save(ab("a"), { target: "overwrite" })).toMatchObject({ ok: false, reason: "cancelled" });
    expect(calls.some(isWrite)).toBe(false);
    expect(m.isFirst()).toBe(false);
    expect(m.asks[0].actions).toEqual(["overwrite", "copy"]);

    m.answers.push("overwrite");
    expect(await m.host.save(ab("a"), { target: "overwrite" })).toMatchObject({ ok: true });
    expect(m.isFirst()).toBe(true);

    expect(await m.host.save(ab("b"), { target: "overwrite" })).toMatchObject({ ok: true });
    expect(m.asks).toHaveLength(2);
  });

  it("Save as copy from the notice writes a sibling copy and toasts its path", async () => {
    router = (c) =>
      isRaw(c) ? new Response("v1") : isWrite(c) ? OK("report.demo.docx") : digestRes("v1");
    const m = mk({}, notice);
    await m.host.snapshot();
    m.answers.push("copy");
    const r = await m.host.save(ab("a"), { target: "overwrite" });
    expect(r).toMatchObject({ ok: true, path: "report.demo.docx" });
    expect(calls.find(isWrite)!.url.searchParams.get("mode")).toBe("copy");
    expect(calls.find(isWrite)!.url.searchParams.has("expectSha1")).toBe(false);
    expect(m.deps.notifyCopy).toHaveBeenCalledWith("report.demo.docx");
    expect(m.token()).toBe(sha("v1")); // tab stays bound to the original file + token
    expect(m.isFirst()).toBe(false);
  });
});

describe("X7 conflict dialog", () => {
  const conflict = (withSha: boolean) =>
    writeRes(409, { success: false, error: "changed on disk", ...(withSha ? { sha1: sha("agent"), mtime: 5 } : {}) });

  function conflictSetup(opts: { withSha?: boolean; second?: () => Response } = {}) {
    let writes = 0;
    let digestBody = "v1";
    router = (c) => {
      if (isRaw(c)) return new Response("v1");
      if (isDigest(c)) return digestRes(digestBody);
      writes += 1;
      if (writes === 1) return conflict(opts.withSha ?? true);
      return opts.second ? opts.second() : OK();
    };
    return { setDigest: (b: string) => (digestBody = b) };
  }

  it("offers Reload, Save as copy and Overwrite anyway (with the loss warning) and Cancel resolves cancelled", async () => {
    conflictSetup();
    const m = mk();
    await m.host.snapshot();
    m.answers.push(null);
    const r = await m.host.save(ab("mine"), { target: "overwrite" });
    expect(r).toMatchObject({ ok: false, reason: "cancelled" });
    expect(m.asks[0].actions).toEqual(["reload", "copy", "overwrite"]);
    expect(calls.filter(isWrite)).toHaveLength(1);
  });

  it("Reload confirms when dirty, remounts and resolves cancelled", async () => {
    conflictSetup();
    const m = mk();
    await m.host.snapshot();
    m.answers.push("reload");
    const r = await m.host.save(ab("mine"), { target: "overwrite" });
    expect(r).toMatchObject({ ok: false, reason: "cancelled" });
    expect(m.deps.guardReload).toHaveBeenCalledTimes(1);
    expect(m.deps.remount).toHaveBeenCalledTimes(1);
  });

  it("Reload declined at the discard confirm does not remount and resolves cancelled", async () => {
    conflictSetup();
    const m = mk({ guardReload: vi.fn(async () => false) });
    await m.host.snapshot();
    m.answers.push("reload");
    expect(await m.host.save(ab("mine"), { target: "overwrite" })).toMatchObject({ ok: false, reason: "cancelled" });
    expect(m.deps.remount).not.toHaveBeenCalled();
  });

  it("Save as copy writes the sibling", async () => {
    conflictSetup({ second: () => OK("report.demo.docx") });
    const m = mk();
    await m.host.snapshot();
    m.answers.push("copy");
    expect(await m.host.save(ab("mine"), { target: "overwrite" })).toMatchObject({ ok: true, path: "report.demo.docx" });
    expect(calls.filter(isWrite)[1].url.searchParams.get("mode")).toBe("copy");
    expect(m.deps.notifyCopy).toHaveBeenCalledWith("report.demo.docx");
  });

  it("Overwrite anyway re-reads the digest and re-sends with the NEW expectSha1", async () => {
    const c = conflictSetup();
    const m = mk();
    await m.host.snapshot();
    c.setDigest("agent");
    m.answers.push("overwrite");
    expect(await m.host.save(ab("mine"), { target: "overwrite" })).toMatchObject({ ok: true });
    const writes = calls.filter(isWrite);
    expect(writes[1].url.searchParams.get("expectSha1")).toBe(sha("agent"));
    expect(m.token()).toBe(sha("new"));
  });

  it("hides Reload and Overwrite anyway when the file is gone (409 without sha1)", async () => {
    conflictSetup({ withSha: false });
    const m = mk();
    await m.host.snapshot();
    m.answers.push(null);
    await m.host.save(ab("mine"), { target: "overwrite" });
    expect(m.asks[0].actions).toEqual(["copy"]);
  });

  it("a conflict that recurs after Overwrite anyway re-opens the dialog", async () => {
    let writes = 0;
    router = (c) => {
      if (isRaw(c)) return new Response("v1");
      if (isDigest(c)) return digestRes("v1");
      writes += 1;
      return writes <= 2 ? conflict(true) : OK();
    };
    const m = mk();
    await m.host.snapshot();
    m.answers.push("overwrite", null);
    expect(await m.host.save(ab("mine"), { target: "overwrite" })).toMatchObject({ ok: false, reason: "cancelled" });
    expect(m.asks).toHaveLength(2);
  });
});

describe("save() — copy target", () => {
  it("copy 409 (no free name) is rejected", async () => {
    router = (c) => (isRaw(c) ? new Response("v1") : isWrite(c) ? writeRes(409, { success: false, error: "no free name" }) : digestRes("v1"));
    const m = mk();
    await m.host.snapshot();
    expect(await m.host.save(ab("x"), { target: "copy" })).toMatchObject({ ok: false, reason: "rejected", message: "no free name" });
  });
});
