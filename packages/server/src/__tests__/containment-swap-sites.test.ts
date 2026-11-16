/**
 * Every content-serving site binds its open to the REAL path the containment decision was made on: a
 * path swapped after the decision (final link, intermediate directory link, dangling link that
 * materialises) is refused in the site's own 403 shape with no byte read and the handle closed, while a
 * same-real-path atomic replace and an unchanged file serve exactly as before.
 *
 * The routes are the real ones. The swap is performed from an `fs.open` / `fs.stat` hook, i.e. strictly
 * after the decision and before the open completes; handles opened on the target are instrumented so
 * "no byte read" and "handle closed" are observed, not inferred from the status code.
 *
 * Site list (test-plan "DEP-02"): read, digest, raw, render, sheet, EML, EML attachment, rendered-pdf and
 * `/api/session-file`. `/api/file/md-read` is a recorded residual (design audit table: no containment
 * decision with `real` in scope) and is deliberately not in the list.
 *
 * See change: close-local-listener-and-egress-gaps (D2; test-plan #E20 #E21 #E22 #E24 #E25 #E26 #E30 #E36 #X9).
 */
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants, recordGrant } from "../access/access-grants.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { ContainmentBindingRefused, DashboardStateRefused, openStateChecked } from "../lib/dashboard-state-guard.js";
import { registerFileRoutes } from "../routes/file-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

const MARKER = "OUTSIDE-SECRET-MARKER-7e41";
const q = encodeURIComponent;

/** A single-part RFC 822 message whose body AND attachment carry `tag`. */
const eml = (tag: string): string =>
  [
    "From: a@x.test",
    "To: b@x.test",
    "Subject: swap-site",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="B"',
    "",
    "--B",
    "Content-Type: text/plain",
    "",
    tag,
    "--B",
    'Content-Type: text/plain; name="att.txt"',
    'Content-Disposition: attachment; filename="att.txt"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(tag).toString("base64"),
    "--B--",
    "",
  ].join("\r\n");

interface Site {
  name: string;
  ext: string;
  /** File bytes carrying `tag` (same length for equal-length tags). */
  bytes(tag: string): string;
  url(cwd: string, p: string): string;
  /** The 200 body is the file with `tag`. */
  serves(res: LightMyRequestResponse, tag: string): boolean;
  /** Office gates `lstat` a grant-admitted path (an in-cwd link is refused before any open). */
  office?: boolean;
}

const cwdPath = (route: string) => (cwd: string, p: string) => `${route}?cwd=${q(cwd)}&path=${q(p)}`;
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

const SITES: Site[] = [
  {
    name: "read",
    ext: ".txt",
    bytes: (t) => t,
    url: cwdPath("/api/file"),
    serves: (r, t) => r.json().data?.content === t,
  },
  {
    name: "digest",
    ext: ".txt",
    bytes: (t) => t,
    url: cwdPath("/api/file/digest"),
    serves: (r, t) => r.json().data?.sha1 === sha1(t),
  },
  { name: "raw", ext: ".txt", bytes: (t) => t, url: cwdPath("/api/file/raw"), serves: (r, t) => r.body === t },
  {
    name: "render",
    ext: ".adoc",
    bytes: (t) => `${t}\n`,
    url: cwdPath("/api/file/render"),
    serves: (r, t) => String(r.json().data?.html).includes(t),
  },
  {
    name: "sheet",
    ext: ".csv",
    bytes: (t) => `h\n${t}\n`,
    url: cwdPath("/api/file/sheet"),
    serves: (r, t) => JSON.stringify(r.json()).includes(t),
    office: true,
  },
  {
    name: "eml",
    ext: ".eml",
    bytes: eml,
    url: cwdPath("/api/file/eml"),
    serves: (r, t) => JSON.stringify(r.json()).includes(t),
  },
  {
    name: "eml-attachment",
    ext: ".eml",
    bytes: eml,
    url: (c, p) => `${cwdPath("/api/file/eml-attachment")(c, p)}&index=0`,
    serves: (r, t) => r.body === t,
  },
  {
    name: "rendered-pdf",
    ext: ".docx",
    bytes: (t) => t,
    url: cwdPath("/api/file/rendered-pdf"),
    serves: (r) => r.body === "%PDF-stub",
    office: true,
  },
  {
    name: "session-file",
    ext: ".txt",
    bytes: (t) => t,
    url: (c, p) => `/api/session-file?sessionId=s1&path=${q(path.isAbsolute(p) ? p : path.join(c, p))}`,
    serves: (r, t) => r.json().data?.content === t,
  },
];

interface Tracked {
  reads: number;
  closes: number;
  stats: number;
}

/** Hooks `fs.open` / `fs.stat` so a swap runs strictly after the decision and before the open completes. */
function hook(target: string, opts: { swap?: () => void; on?: Array<"open" | "stat"> } = {}) {
  const on = opts.on ?? ["open"];
  const state = { swapped: false, opens: 0, handles: [] as Tracked[], statFail: undefined as { onCall: number; err: Error } | undefined };
  const fire = () => {
    if (state.swapped) return;
    state.swapped = true;
    opts.swap?.();
  };
  const realOpen = fsp.open.bind(fsp);
  const realStat = fsp.stat.bind(fsp);
  vi.spyOn(fsp, "open").mockImplementation((async (p: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
    const hit = String(p) === target;
    if (hit && on.includes("open")) fire();
    const fh = await (realOpen as (...a: unknown[]) => Promise<Awaited<ReturnType<typeof fsp.open>>>)(p, ...rest);
    if (hit) {
      state.opens++;
      const rec: Tracked = { reads: 0, closes: 0, stats: 0 };
      state.handles.push(rec);
      for (const m of ["read", "readFile", "createReadStream"] as const) {
        const orig = (fh[m] as (...a: unknown[]) => unknown).bind(fh);
        (fh as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
          rec.reads++;
          return orig(...a);
        };
      }
      const origClose = fh.close.bind(fh);
      fh.close = (() => {
        rec.closes++;
        return origClose();
      }) as typeof fh.close;
      const origStat = fh.stat.bind(fh);
      fh.stat = ((...a: unknown[]) => {
        rec.stats++;
        if (state.statFail && rec.stats === state.statFail.onCall) return Promise.reject(state.statFail.err);
        return (origStat as (...x: unknown[]) => Promise<unknown>)(...a);
      }) as typeof fh.stat;
    }
    return fh;
  }) as never);
  vi.spyOn(fsp, "stat").mockImplementation((async (p: Parameters<typeof fsp.stat>[0], ...rest: unknown[]) => {
    if (String(p) === target && on.includes("stat")) fire();
    return (realStat as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
  }) as never);
  return state;
}

const errno = (code: string): Error => Object.assign(new Error(code), { code });

describe("open bound to the decided real path, at every content site", () => {
  let base: string;
  let cwd: string;
  let outside: string;
  let app: FastifyInstance;
  let savedStore: string | undefined;
  let savedHome: string | undefined;

  beforeEach(async () => {
    base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "swap-sites-")));
    cwd = path.join(base, "cwd");
    outside = path.join(base, "out");
    await fsp.mkdir(cwd);
    await fsp.mkdir(outside);
    savedHome = process.env.HOME;
    process.env.HOME = path.join(base, "home");
    await fsp.mkdir(process.env.HOME);
    savedStore = process.env.PI_ACCESS_GRANTS_STORE;
    process.env.PI_ACCESS_GRANTS_STORE = path.join(base, "grants.json");
    __resetAccessGrants();
    __resetPathDenials();
    installGrantCoordinator(null);
    app = Fastify({ logger: false });
    const sessionManager = { listAll: () => [{ cwd }], get: (id: string) => (id === "s1" ? { id, cwd } : undefined) } as never;
    registerFileRoutes(app, {
      sessionManager,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      networkGuard: async () => undefined,
      docxPdfEngine: { available: async () => true, toPdf: async (_p: string, out: string) => void (await fsp.writeFile(out, "%PDF-stub")) },
    } as never);
    registerSessionRoutes(app, { sessionManager, eventStore: {} as never, networkGuard: async () => undefined } as never);
    await app.ready();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    __resetAccessGrants();
    process.env.HOME = savedHome;
    if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
    await fsp.rm(base, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: "GET", url });
  const write = (p: string, s: string) => fsSync.writeFileSync(p, s);

  /** The shared refusal contract of a swapped path: the site's 403 shape, no outside bytes, handle closed unread. */
  function expectRefused(site: Site, res: LightMyRequestResponse, st: ReturnType<typeof hook>): void {
    expect(st.swapped, `${site.name}: swap ran`).toBe(true);
    expect(st.opens, `${site.name}: the open was reached (refusal came from the binding, not containment)`).toBeGreaterThanOrEqual(1);
    expect(res.statusCode, site.name).toBe(403);
    expect(res.json().success, site.name).toBe(false);
    expect(res.body, site.name).not.toContain(MARKER);
    for (const h of st.handles) {
      expect(h.reads, `${site.name}: bytes read from a refused handle`).toBe(0);
      expect(h.closes, `${site.name}: refused handle closed`).toBe(1);
    }
  }

  describe.each(SITES)("$name", (site) => {
    it("T.20 final component swapped to an outside link after the decision → refused, nothing read, handle closed", async () => {
      const file = path.join(cwd, `a${site.ext}`);
      const secret = path.join(outside, `secret${site.ext}`);
      write(file, site.bytes("INSIDE-BYTES"));
      write(secret, site.bytes(MARKER));
      const st = hook(file, {
        swap: () => {
          fsSync.rmSync(file);
          fsSync.symlinkSync(secret, file);
        },
      });
      const res = await get(site.url(cwd, `a${site.ext}`));
      expectRefused(site, res, st);
    });

    it("T.21 intermediate directory swapped to an outside directory link → refused, nothing read", async () => {
      await fsp.mkdir(path.join(cwd, "d"));
      await fsp.mkdir(path.join(outside, "d2"));
      const file = path.join(cwd, "d", `a${site.ext}`);
      write(file, site.bytes("INSIDE-BYTES"));
      write(path.join(outside, "d2", `a${site.ext}`), site.bytes(MARKER));
      const st = hook(file, {
        swap: () => {
          fsSync.renameSync(path.join(cwd, "d"), path.join(cwd, "d.orig"));
          fsSync.symlinkSync(path.join(outside, "d2"), path.join(cwd, "d"));
        },
      });
      const res = await get(site.url(cwd, `d/a${site.ext}`));
      expectRefused(site, res, st);
    });

    it("T.24 nothing changes between decision and open → served exactly as before", async () => {
      write(path.join(cwd, `a${site.ext}`), site.bytes("INSIDE-BYTES"));
      const st = hook(path.join(cwd, `a${site.ext}`));
      const res = await get(site.url(cwd, `a${site.ext}`));
      expect(res.statusCode, site.name).toBe(200);
      expect(site.serves(res, "INSIDE-BYTES"), `${site.name}: body ${res.body.slice(0, 200)}`).toBe(true);
      expect(st.opens).toBeGreaterThanOrEqual(1);
    });

    it("T.25 atomically replaced by a different regular file at the SAME real path → the new file is served", async () => {
      const file = path.join(cwd, `a${site.ext}`);
      write(file, site.bytes("INSIDE-OLD1"));
      const before = fsSync.statSync(file).ino;
      const st = hook(file, {
        swap: () => {
          write(`${file}.new`, site.bytes("INSIDE-NEW2"));
          fsSync.renameSync(`${file}.new`, file);
        },
      });
      const res = await get(site.url(cwd, `a${site.ext}`));
      expect(st.swapped).toBe(true);
      expect(fsSync.statSync(file).ino).not.toBe(before); // a genuinely different inode
      expect(res.statusCode, `${site.name}: ${res.body.slice(0, 200)}`).toBe(200);
      expect(site.serves(res, "INSIDE-NEW2"), `${site.name}: body ${res.body.slice(0, 200)}`).toBe(true);
    });

    it("T.26 a dangling link whose target materialises before the open → refused, marker never served", async () => {
      const link = path.join(cwd, `l${site.ext}`);
      const target = path.join(outside, `new${site.ext}`);
      fsSync.symlinkSync(target, link); // dangling at decision time: admitted via the nearest existing ancestor
      const st = hook(link, { on: ["stat", "open"], swap: () => write(target, site.bytes(MARKER)) });
      const res = await get(site.url(cwd, `l${site.ext}`));
      expectRefused(site, res, st);
    });
  });

  it("T.36 a failing post-open `realpath` (EACCES) or `fh.stat()` (EIO) is a binding refusal: handle closed once, site 403, never 2xx/500", async () => {
    const file = path.join(cwd, "a");
    write(file, "INSIDE-BYTES");
    for (const fault of ["realpath-EACCES", "stat-EIO"] as const) {
      vi.restoreAllMocks();
      const st = hook(file);
      if (fault === "stat-EIO") {
        // 1st `fh.stat()` is the always-refused-identity recheck; the 2nd is the binding check.
        st.statFail = { onCall: 2, err: errno("EIO") };
      } else {
        const realRealpath = fsp.realpath.bind(fsp);
        vi.spyOn(fsp, "realpath").mockImplementation((async (p: Parameters<typeof fsp.realpath>[0], ...rest: unknown[]) => {
          if (String(p) === file && st.opens > 0) throw errno("EACCES");
          return (realRealpath as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
        }) as never);
      }
      const res = await get(`/api/file?cwd=${q(cwd)}&path=a`);
      expect(res.statusCode, fault).toBe(403);
      expect(res.json(), fault).toEqual({ success: false, error: "path outside working directory" });
      expect(st.handles, fault).toHaveLength(1);
      expect(st.handles[0].closes, `${fault}: closed exactly once`).toBe(1);
      expect(st.handles[0].reads, `${fault}: no byte read`).toBe(0);

      // The bound open called directly: the typed refusal, handle closed once, still no read.
      vi.restoreAllMocks();
      const direct = hook(file);
      if (fault === "stat-EIO") direct.statFail = { onCall: 2, err: errno("EIO") };
      else {
        const realRealpath = fsp.realpath.bind(fsp);
        vi.spyOn(fsp, "realpath").mockImplementation((async (p: Parameters<typeof fsp.realpath>[0], ...rest: unknown[]) => {
          if (String(p) === file && direct.opens > 0) throw errno("EACCES");
          return (realRealpath as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
        }) as never);
      }
      const err = await openStateChecked(file, "r", { decidedReal: file }).catch((e) => e);
      expect(err, fault).toBeInstanceOf(ContainmentBindingRefused);
      expect(err, fault).toBeInstanceOf(DashboardStateRefused);
      expect(direct.handles[0].closes, `${fault}: direct close count`).toBe(1);
      expect(direct.handles[0].reads, fault).toBe(0);
    }
  });

  it("T.30 a hard link inside the cwd to an outside file is served (accepted residual CG1: pinned, not a defect)", async () => {
    const target = path.join(outside, "secret.txt");
    write(target, MARKER);
    fsSync.linkSync(target, path.join(cwd, "h"));
    expect(fsSync.statSync(path.join(cwd, "h")).nlink).toBe(2);
    const res = await get(`/api/file?cwd=${q(cwd)}&path=h`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe(MARKER);
  });

  describe("T.22 grant-admitted decisions are bound too", () => {
    let repoSub: string;
    beforeEach(async () => {
      repoSub = path.join(base, "repo", "sub");
      await fsp.mkdir(repoSub, { recursive: true });
      expect(recordGrant({ subject: repoSub, scope: "project", origin: "test" }).ok).toBe(true);
    });

    // Office gates `lstat` a grant-admitted path, so they take the granted file directly; the others come through the cwd link.
    it.each(SITES)("$name: the granted real path swapped to an outside link → refused, nothing read", async (site) => {
      const real = path.join(repoSub, `a${site.ext}`);
      const secret = path.join(outside, `secret${site.ext}`);
      write(real, site.bytes("INSIDE-BYTES"));
      write(secret, site.bytes(MARKER));
      let entry = `link${site.ext}`;
      if (site.office || site.name === "session-file") entry = real;
      else fsSync.symlinkSync(real, path.join(cwd, entry));
      const st = hook(real, {
        swap: () => {
          fsSync.rmSync(real);
          fsSync.symlinkSync(secret, real);
        },
      });
      const res = await get(site.url(cwd, entry));
      expect(st.swapped, site.name).toBe(true);
      // The EML routes keep their pre-existing 400 for a grant-admitted handle-verification refusal
      // (`agent-credential-routes.test.ts` X8 pins it); every other site answers its 403.
      const expected = site.name.startsWith("eml") ? 400 : 403;
      expect(res.statusCode, `${site.name}: ${res.body.slice(0, 200)}`).toBe(expected);
      expect(res.json().success, site.name).toBe(false);
      expect(res.body, site.name).not.toContain(MARKER);
      for (const h of st.handles) {
        expect(h.reads, site.name).toBe(0);
        expect(h.closes, site.name).toBe(1);
      }
    });

    it("an intermediate directory inside the grant swapped to an outside directory link is refused by the bound open", async () => {
      await fsp.mkdir(path.join(repoSub, "d"));
      await fsp.mkdir(path.join(outside, "d2"));
      write(path.join(repoSub, "d", "a.txt"), "INSIDE-BYTES");
      write(path.join(outside, "d2", "a.txt"), MARKER);
      const file = path.join(repoSub, "d", "a.txt");
      const st = hook(file, {
        swap: () => {
          fsSync.renameSync(path.join(repoSub, "d"), path.join(repoSub, "d.orig"));
          fsSync.symlinkSync(path.join(outside, "d2"), path.join(repoSub, "d"));
        },
      });
      const res = await get(`/api/file?cwd=${q(cwd)}&path=${q(file)}`);
      expect(st.opens).toBeGreaterThanOrEqual(1);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(MARKER);
      for (const h of st.handles) {
        expect(h.reads).toBe(0);
        expect(h.closes).toBe(1);
      }
    });
  });

  describe("T.161 concurrent reads while a link flips between an inside and an outside file", () => {
    it("`<cwd>/l` flipping 200× under 50 concurrent reads never serves outside bytes", async () => {
      write(path.join(cwd, "inside.txt"), "INSIDE-BYTES");
      write(path.join(outside, "secret.txt"), MARKER);
      const link = path.join(cwd, "l");
      fsSync.symlinkSync(path.join(cwd, "inside.txt"), link);
      const flip = (i: number) => {
        const tmp = path.join(cwd, `.flip-${i}`);
        fsSync.symlinkSync(i % 2 === 0 ? path.join(outside, "secret.txt") : path.join(cwd, "inside.txt"), tmp);
        fsSync.renameSync(tmp, link); // atomic: `l` always exists
      };
      let done = false;
      const flipper = (async () => {
        for (let i = 0; i < 200; i++) {
          flip(i);
          await new Promise((r) => setImmediate(r));
        }
        done = true;
      })();
      const outcomes: Array<{ status: number; body: string }> = [];
      while (!done) {
        const batch = await Promise.all(
          Array.from({ length: 50 }, () => get(`/api/file?cwd=${q(cwd)}&path=l`).then((r) => ({ status: r.statusCode, body: r.body }))),
        );
        outcomes.push(...batch);
      }
      await flipper;
      expect(outcomes.length).toBeGreaterThanOrEqual(50);
      for (const o of outcomes) {
        expect(o.body).not.toContain(MARKER);
        if (o.status === 200) expect(JSON.parse(o.body).data.content).toBe("INSIDE-BYTES");
        else {
          // The property is "never outside bytes"; a flip landing mid-lookup may legitimately read as not-found.
          expect([403, 404]).toContain(o.status);
          expect(JSON.parse(o.body)).toMatchObject({ success: false });
        }
      }
    }, 60_000);

    it("the admitted REAL path itself flipping between a regular file and an outside link never serves outside bytes", async () => {
      const real = path.join(cwd, "a.txt");
      write(real, "INSIDE-BYTES");
      write(path.join(outside, "secret.txt"), MARKER);
      let done = false;
      const flipper = (async () => {
        for (let i = 0; i < 200; i++) {
          const tmp = path.join(cwd, `.flip-${i}`);
          if (i % 2 === 0) fsSync.symlinkSync(path.join(outside, "secret.txt"), tmp);
          else write(tmp, "INSIDE-BYTES");
          fsSync.renameSync(tmp, real);
          await new Promise((r) => setImmediate(r));
        }
        done = true;
      })();
      const outcomes: Array<{ status: number; body: string }> = [];
      while (!done) {
        const batch = await Promise.all(
          Array.from({ length: 50 }, () => get(`/api/file?cwd=${q(cwd)}&path=a.txt`).then((r) => ({ status: r.statusCode, body: r.body }))),
        );
        outcomes.push(...batch);
      }
      await flipper;
      for (const o of outcomes) {
        expect(o.body).not.toContain(MARKER);
        if (o.status === 200) expect(JSON.parse(o.body).data.content).toBe("INSIDE-BYTES");
        else expect([403, 404]).toContain(o.status);
      }
    }, 60_000);
  });
});
