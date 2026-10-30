/**
 * pi-agent credential files (`~/.pi/agent/{auth,mcp-auth,providers,plugin-credentials,models,mcp}.json`,
 * `system-one/auth.json`) are refused by EVERY path-taking route, for every caller, whatever anchor,
 * grant or cwd admits the path — and a swap/hard link to one after the path check is caught on the open
 * handle. The routes are the real ones; the caller is injected through the same `stateCallerFor` +
 * `runWithStateCaller` pair `server.ts` installs.
 *
 * See change: close-security-map-high-findings
 * (D1; test-plan #E1–#E8, #E15–#E18, #E20, #E23–#E25, #P1, #X1–#X8, #X10, #X11, #X14).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants, recordGrant } from "../access/access-grants.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { openVerifiedRegularFile, VerifiedReadRefused } from "../access/verified-read.js";
import { stateCallerFor } from "../auth/dashboard-state-caller.js";
import { createLocalTrustContext, LOCAL_PROOF_COOKIE, signLocalProof } from "../auth/local-proof.js";
import { resetArtifactRootsCache } from "../lib/artifact-roots.js";
import { __resetCredentialVolumeProbes, runWithStateCaller } from "../lib/dashboard-state-guard.js";
import { grepWithJsScan } from "../lib/grep.js";
import { detectRipgrep, resetRipgrepCache } from "../ripgrep-detection.js";
import { registerFileRoutes } from "../routes/file-routes.js";
import { registerGrepRoutes } from "../routes/grep-routes.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

const MARK = "AGENT-CRED-MARKER-b81f6e02";
const CRED_NAMES = ["auth.json", "mcp-auth.json", "providers.json", "plugin-credentials.json", "models.json", "mcp.json", "system-one/auth.json"];

let home: string;
let origHome: string | undefined;
let origAgentEnv: string | undefined;
let origStore: string | undefined;
let proj: string;
let strict = true;
let sessionCwd: string;
const ctx = createLocalTrustContext("tok-for-credential-tests", () => strict);

type Kind = "unproven" | "proofed" | "session" | "device" | "optout";
const KINDS: Kind[] = ["unproven", "proofed", "session", "device", "optout"];

const agent = (...p: string[]) => path.join(home, ".pi", "agent", ...p);
const dash = (...p: string[]) => path.join(home, ".pi", "dashboard", ...p);
const write = (p: string, body: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.rmSync(p, { force: true }); // never write THROUGH a symlink / hard link left by an earlier swap
  fs.writeFileSync(p, body);
};

const onDenial = vi.fn(() => ({ held: false, result: Promise.resolve({ kind: "deny" as const, reason: "disabled" }), release: () => {} }));
const opened: string[][] = [];
const toPdf = vi.fn(async () => {});

beforeEach(() => {
  origHome = process.env.HOME;
  origAgentEnv = process.env.PI_CODING_AGENT_DIR;
  origStore = process.env.PI_ACCESS_GRANTS_STORE;
  delete process.env.PI_CODING_AGENT_DIR;
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-routes-")));
  process.env.HOME = home;
  process.env.PI_ACCESS_GRANTS_STORE = path.join(home, "grants-store.json");
  proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-proj-")));
  sessionCwd = proj;
  for (const n of CRED_NAMES) write(agent(n), `${MARK}-${n}`);
  write(dash("local", "token"), `${MARK}-token`);
  write(dash("identity.key"), `${MARK}-identity`);
  write(dash("config.json"), JSON.stringify({ auth: { secret: `${MARK}-config` } }));
  strict = true;
  opened.length = 0;
  toPdf.mockClear();
  onDenial.mockClear();
  __resetAccessGrants();
  __resetPathDenials();
  __resetCredentialVolumeProbes();
  installGrantCoordinator({ onDenial } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  installGrantCoordinator(null);
  process.env.HOME = origHome;
  if (origAgentEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = origAgentEnv;
  if (origStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
  else process.env.PI_ACCESS_GRANTS_STORE = origStore;
  __resetAccessGrants();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(proj, { recursive: true, force: true });
});

function headersFor(kind: Kind): Record<string, string> {
  const h: Record<string, string> = { host: "127.0.0.1:8000", "x-test-kind": kind };
  if (kind === "proofed") h.cookie = `${LOCAL_PROOF_COOKIE}=${signLocalProof(ctx)}`;
  return h;
}

async function makeApp(cwds: string[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", (request, _reply, done) => {
    const kind = request.headers["x-test-kind"] as Kind | undefined;
    if (kind === "session") {
      (request as { isAuthenticated?: boolean }).isAuthenticated = true;
      (request as { authVia?: string }).authVia = "session";
    } else if (kind === "device") {
      (request as { isAuthenticated?: boolean }).isAuthenticated = true;
      (request as { authVia?: string }).authVia = "device";
    }
    const effective = kind === "optout" ? createLocalTrustContext("tok-for-credential-tests", () => false) : ctx;
    runWithStateCaller(stateCallerFor(request, effective), done);
  });
  const sessionManager = {
    listAll: () => cwds.map((cwd) => ({ cwd })),
    get: (id: string) => (id === "s1" ? { id, cwd: sessionCwd } : undefined),
  } as never;
  registerFileRoutes(app, {
    sessionManager,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
    systemOpen: { capable: () => true, run: (cmd: string, args: string[]) => void opened.push([cmd, ...args]) },
    docxPdfEngine: { toPdf } as never,
  } as never);
  registerGrepRoutes(app, { sessionManager, networkGuard: async () => undefined });
  registerSessionRoutes(app, { sessionManager, eventStore: {} as never, networkGuard: async () => undefined } as never);
  registerOpenSpecRoutes(app, {
    sessionManager,
    preferencesStore: { getPinnedDirectories: () => [], getWorkspaces: () => [], getOpenSpecUpdateSignature: () => undefined } as never,
    directoryService: {} as never,
    networkGuard: async () => undefined,
    getOpenSpecConfig: () => ({ enabled: true, optOutDirectories: [], workflowSchema: { defaultForNewProjects: false } }),
  } as never);
  await app.ready();
  return app;
}

const get = (app: FastifyInstance, kind: Kind, url: string) =>
  app.inject({ method: "GET", url, remoteAddress: "127.0.0.1", headers: headersFor(kind) });
const post = (app: FastifyInstance, url: string, body: unknown, kind: Kind = "unproven") =>
  app.inject({
    method: "POST",
    url,
    remoteAddress: "127.0.0.1",
    headers: { ...headersFor(kind), "content-type": "application/json", origin: "http://localhost:8000" },
    payload: JSON.stringify(body),
  });
const q = encodeURIComponent;
const fileUrl = (cwd: string, p: string, route = "/api/file") => `${route}?cwd=${q(cwd)}&path=${q(p)}`;
const sessionFileUrl = (p: string) => `/api/session-file?sessionId=s1&path=${q(p)}`;
const resourceUrl = (p: string) => `/api/pi-resource-file?path=${q(p)}`;

/** Remedy fields a prompt-able denial carries; a credential refusal has none. */
const REMEDY_FIELDS = ["denialId", "reason", "hint", "subject", "ancestors", "promptOutcome"];
function expectPlainRefusal(res: { statusCode: number; body: string; json(): Record<string, unknown> }, error: string, label = "") {
  expect(res.statusCode, label).toBe(403);
  expect(res.json(), label).toEqual({ success: false, error });
  for (const f of REMEDY_FIELDS) expect(Object.hasOwn(res.json(), f), `${label} ${f}`).toBe(false);
  expect(res.body, label).not.toContain(MARK);
}

/** The next `fs.open` of `target` first swaps it for a symlink / hard link to a credential file. */
function swapOnOpen(target: string, how: "symlink" | "hardlink", cred = agent("auth.json")): () => boolean {
  const realOpen = fsp.open.bind(fsp);
  let done = false;
  vi.spyOn(fsp, "open").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
    if (!done && String(p) === target) {
      done = true;
      fs.rmSync(target);
      if (how === "symlink") fs.symlinkSync(cred, target);
      else fs.linkSync(cred, target);
    }
    return (realOpen as (...a: unknown[]) => Promise<fsp.FileHandle>)(p, ...rest);
  }) as never);
  return () => done;
}

describe("E1 — credential files refused for every caller at /api/file (the ~/.pi anchor)", () => {
  it("7 names × 5 callers: 403, no marker, no remedy fields, no access prompt", async () => {
    const app = await makeApp([proj]);
    for (const name of CRED_NAMES) {
      for (const kind of KINDS) {
        const res = await get(app, kind, fileUrl(proj, agent(name)));
        expectPlainRefusal(res, "path outside working directory", `${kind} ${name}`);
      }
    }
    expect(onDenial).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("E2 — a HOME cwd does not expose credentials, in any path spelling", () => {
  it("relative, absolute, dotted and doubled-slash spellings are all refused", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    for (const p of [".pi/agent/auth.json", agent("auth.json"), "./.pi/./agent/../agent/auth.json", ".pi//agent//auth.json"]) {
      expectPlainRefusal(await get(app, "proofed", fileUrl(home, p)), "path outside working directory", p);
    }
    await app.close();
  });
});

describe("E3 / E4 — /api/session-file", () => {
  it("E3 the in-cwd shortcut does not bypass the refusal (cwd = $HOME), any caller, relative or absolute", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    for (const kind of ["unproven", "device", "proofed", "session"] as Kind[]) {
      for (const p of [".pi/agent/auth.json", ".pi/dashboard/local/token", ".pi/dashboard/identity.key", agent("auth.json"), dash("local", "token")]) {
        expectPlainRefusal(await get(app, kind, sessionFileUrl(p)), "path outside session directory", `${kind} ${p}`);
      }
    }
    await app.close();
  });

  it("E4 ordinary reads are unchanged; the trust-gated tier is now enforced here (unproven refused, proofed/session served)", async () => {
    sessionCwd = home;
    write(path.join(home, "notes.txt"), "plain notes");
    write(agent("settings.json"), '{"a":1}');
    const app = await makeApp([home]);
    for (const kind of ["unproven", "proofed", "session"] as Kind[]) {
      const notes = await get(app, kind, sessionFileUrl("notes.txt"));
      expect(notes.statusCode, kind).toBe(200);
      expect(notes.json().data.content).toBe("plain notes");
      const settings = await get(app, kind, sessionFileUrl(".pi/agent/settings.json"));
      expect(settings.statusCode, kind).toBe(200);
      expect(settings.json().data.content).toBe('{"a":1}');
    }
    expect((await get(app, "unproven", sessionFileUrl(".pi/dashboard/config.json"))).statusCode).toBe(403);
    expect((await get(app, "proofed", sessionFileUrl(".pi/dashboard/config.json"))).statusCode).toBe(200);
    expect((await get(app, "session", sessionFileUrl(".pi/dashboard/config.json"))).statusCode).toBe(200);
    await app.close();
  });

  it("X14 a missing credential file is refused on its name (never a 404 that differs from presence)", async () => {
    fs.rmSync(agent("auth.json"));
    sessionCwd = home;
    const app = await makeApp([home]);
    expectPlainRefusal(await get(app, "proofed", sessionFileUrl(".pi/agent/auth.json")), "path outside session directory");
    expectPlainRefusal(await get(app, "proofed", fileUrl(home, ".pi/agent/auth.json")), "path outside working directory");
    await app.close();
  });

  it("X5 a swap to a symlink / hard link after the check is refused on the handle (non-grant branch)", async () => {
    sessionCwd = proj;
    for (const how of ["symlink", "hardlink"] as const) {
      write(path.join(proj, "p.txt"), "ordinary");
      const swapped = swapOnOpen(path.join(proj, "p.txt"), how);
      const app = await makeApp([proj]);
      const res = await get(app, "proofed", sessionFileUrl("p.txt"));
      expect(swapped(), how).toBe(true);
      expectPlainRefusal(res, "path outside session directory", how);
      await app.close();
      vi.restoreAllMocks();
    }
  });
});

describe("E5 / E6 / E7 — /api/pi-resource-file", () => {
  it("E5 refuses credentials (both tiers on the real path); the token for everyone; config.json by caller", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    for (const kind of KINDS) {
      expectPlainRefusal(await get(app, kind, resourceUrl(agent("auth.json"))), "path not in allowed resource location", `${kind} auth.json`);
      expectPlainRefusal(await get(app, kind, resourceUrl(dash("local", "token"))), "path not in allowed resource location", `${kind} token`);
    }
    expect((await get(app, "unproven", resourceUrl(dash("config.json")))).statusCode).toBe(403);
    expect((await get(app, "unproven", resourceUrl(dash("config.json")))).body).not.toContain(MARK);
    const proofed = await get(app, "proofed", resourceUrl(dash("config.json")));
    expect(proofed.statusCode).toBe(200);
    expect(proofed.json().data.content).toContain(MARK);
    await app.close();
  });

  it("E6 decides on the real path of a symlink, including a chain", async () => {
    write(path.join(proj, "node_modules", "x", "placeholder"), "x");
    fs.symlinkSync(agent("auth.json"), path.join(proj, "node_modules", "x", "auth.json"));
    write(path.join(proj, ".pi", "skills", "placeholder"), "x");
    fs.symlinkSync(agent("mcp-auth.json"), path.join(proj, ".pi", "skills", "y.md"));
    fs.symlinkSync(agent("auth.json"), path.join(proj, "l1"));
    fs.symlinkSync(path.join(proj, "l1"), path.join(proj, "l2"));
    fs.symlinkSync(path.join(proj, "l2"), path.join(proj, "node_modules", "chain.json"));
    const app = await makeApp([proj]);
    for (const p of [path.join(proj, "node_modules", "x", "auth.json"), path.join(proj, ".pi", "skills", "y.md"), path.join(proj, "node_modules", "chain.json")]) {
      expectPlainRefusal(await get(app, "proofed", resourceUrl(p)), "path not in allowed resource location", p);
    }
    await app.close();
  });

  it("E7 resource files and non-credential ~/.pi files are served byte-identically", async () => {
    write(agent("skills", "demo", "SKILL.md"), "# skill\nbody\n");
    write(agent("prompts", "p.md"), "prompt body\n");
    write(agent("settings.json"), '{"theme":"dark"}');
    write(agent("trust.json"), '{"trusted":[]}');
    const app = await makeApp([proj]);
    for (const p of [agent("skills", "demo", "SKILL.md"), agent("prompts", "p.md")]) {
      const res = await get(app, "device", resourceUrl(p));
      expect(res.statusCode, p).toBe(200);
      expect(res.json().data.content, p).toBe(fs.readFileSync(p, "utf-8"));
    }
    for (const p of [agent("skills", "demo", "SKILL.md"), agent("prompts", "p.md"), agent("settings.json"), agent("trust.json")]) {
      const res = await get(app, "device", fileUrl(proj, p));
      expect(res.statusCode, p).toBe(200);
      expect(res.json().data.content, p).toBe(fs.readFileSync(p, "utf-8"));
    }
    await app.close();
  });

  it("X6 a swap to a symlink / hard link after the check is refused on the handle", async () => {
    for (const how of ["symlink", "hardlink"] as const) {
      write(agent("skills", "p.md"), "ordinary");
      const swapped = swapOnOpen(agent("skills", "p.md"), how);
      const app = await makeApp([proj]);
      const res = await get(app, "proofed", resourceUrl(agent("skills", "p.md")));
      expect(swapped(), how).toBe(true);
      expectPlainRefusal(res, "path not in allowed resource location", how);
      await app.close();
      vi.restoreAllMocks();
    }
  });
});

describe("E15 / E16 / E17 / E18 / E20 / E23 — the other file routes", () => {
  it("E15 open-in-system / reveal refuse a credential and its sibling; nothing is spawned", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    write(agent("auth.json.bak"), MARK);
    for (const url of ["/api/open-in-system", "/api/reveal-in-file-manager"]) {
      for (const p of [".pi/agent/auth.json", ".pi/agent/auth.json.bak"]) {
        const res = await post(app, url, { cwd: home, path: p });
        expect(res.statusCode, `${url} ${p}`).toBe(403);
        expect(res.json().success).toBe(false);
        expect(Object.hasOwn(res.json(), "denialId")).toBe(false);
      }
    }
    expect(opened).toEqual([]);
    await app.close();
  });

  it("E16 digest / md-read / eml / eml-attachment / raw / render / sheet refuse the credential path (cwd = $HOME)", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    const cases: Array<[string, string]> = [
      ["/api/file/digest", ".pi/agent/auth.json"],
      ["/api/file/md-read", ".pi/agent/auth.json.md"],
      ["/api/file/eml", ".pi/agent/auth.json.eml"],
      ["/api/file/eml-attachment&index=0", ".pi/agent/auth.json.eml"],
      ["/api/file/raw", ".pi/agent/auth.json"],
      ["/api/file/render", ".pi/agent/auth.json.adoc"],
      ["/api/file/sheet", ".pi/agent/auth.json.csv"],
    ];
    for (const [route, p] of cases) {
      const [r, extra] = route.split("&");
      const res = await get(app, "proofed", `${fileUrl(home, p, r)}${extra ? `&${extra}` : ""}`);
      expect(res.statusCode, route).toBe(403);
      // md-read refuses through its own scoped-markdown guard (the credential sibling is no readable markdown target).
      expect(res.json(), route).toMatchObject({
        success: false,
        error: route === "/api/file/md-read" ? "target is not a readable markdown file in scope" : "path outside working directory",
      });
      expect(res.body, route).not.toContain(MARK);
      expect(res.body, route).not.toMatch(/[0-9a-f]{40}/);
    }
    // and the exact credential name where the route takes it
    for (const r of ["/api/file/digest", "/api/file/raw"]) {
      expectPlainRefusal(await get(app, "proofed", fileUrl(home, ".pi/agent/auth.json", r)), "path outside working directory", r);
    }
    await app.close();
  });

  it("E17 rendered-pdf decides on the real path before the converter runs", async () => {
    fs.symlinkSync(agent("auth.json"), path.join(proj, "x.docx"));
    const app = await makeApp([proj]);
    const res = await get(app, "proofed", fileUrl(proj, "x.docx", "/api/file/rendered-pdf"));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "path outside working directory" });
    expect(toPdf).not.toHaveBeenCalled();
    await app.close();
  });

  it("X10 rendered-pdf: a swap between the decision and the checked open is refused; the converter never runs", async () => {
    write(path.join(proj, "x.docx"), "DOCX-BYTES");
    const swapped = swapOnOpen(path.join(proj, "x.docx"), "hardlink");
    const app = await makeApp([proj]);
    const res = await get(app, "proofed", fileUrl(proj, "x.docx", "/api/file/rendered-pdf"));
    expect(swapped()).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "path outside working directory" });
    expect(toPdf).not.toHaveBeenCalled();
    await app.close();
  });

  it("E18 tree MAY list the credential file names; exists of a credential path is refused like a content read", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    const tree = await get(app, "proofed", fileUrl(home, ".pi/agent", "/api/file/tree"));
    expect(tree.statusCode).toBe(200);
    expect(JSON.stringify(tree.json())).toContain("auth.json");
    expect(tree.body).not.toContain(MARK);
    const exists = await get(app, "proofed", fileUrl(home, agent("auth.json"), "/api/file/exists"));
    expect(exists.statusCode).toBe(403);
    expect(exists.json()).toMatchObject({ success: false, error: "path outside cwd" });
    expect(exists.body).not.toContain(MARK);
    await app.close();
  });

  it("E20 children of a `<name>.*` directory are served by name; the directory entries and an identity match are refused", async () => {
    write(agent("models.json.d", "frag.json"), "fragment body");
    write(agent("auth.json.bak", "x.txt"), "x body");
    const app = await makeApp([proj]);
    expect((await get(app, "proofed", fileUrl(proj, agent("models.json.d", "frag.json")))).json().data.content).toBe("fragment body");
    expect((await get(app, "proofed", fileUrl(proj, agent("auth.json.bak", "x.txt")))).json().data.content).toBe("x body");
    expect((await get(app, "proofed", fileUrl(proj, agent("models.json.d")))).statusCode).toBe(403);
    fs.rmSync(agent("models.json.d", "frag.json"));
    fs.linkSync(agent("auth.json"), agent("models.json.d", "frag.json"));
    expectPlainRefusal(await get(app, "proofed", fileUrl(proj, agent("models.json.d", "frag.json"))), "path outside working directory");
    await app.close();
  });

  it("E11 POST /api/file/write cannot target a credential sibling; the file stays absent; notes.md is written as before", async () => {
    sessionCwd = home;
    const app = await makeApp([home]);
    const body = (p: string) => ({ path: p, content: "# overwritten", mtime: 0 });
    const postWrite = (p: string) =>
      app.inject({ method: "POST", url: "/api/file/write", remoteAddress: "127.0.0.1", headers: headersFor("proofed"), payload: body(p) });
    for (const n of ["auth.json.md", "models.json.md", "mcp.json.x.md"]) {
      const res = await postWrite(agent(n));
      expect(res.statusCode, n).toBe(403);
      expect(fs.existsSync(agent(n)), n).toBe(false);
    }
    fs.writeFileSync(agent("notes.md"), "# notes");
    const ok = await app.inject({
      method: "POST",
      url: "/api/file/write",
      remoteAddress: "127.0.0.1",
      headers: headersFor("proofed"),
      payload: { path: agent("notes.md"), content: "# changed", mtime: fs.statSync(agent("notes.md")).mtimeMs },
    });
    expect(ok.statusCode).toBe(200);
    expect(fs.readFileSync(agent("notes.md"), "utf-8")).toBe("# changed");
    await app.close();
  });

  it("E23 a session-side PI_CODING_AGENT_DIR override stays admitted (documented residual)", async () => {
    const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "elsewhere-")));
    try {
      write(path.join(elsewhere, "auth.json"), "SESSION-SIDE-AGENT-DIR");
      const app = await makeApp([elsewhere]);
      const res = await get(app, "proofed", fileUrl(elsewhere, "auth.json"));
      expect(res.statusCode).toBe(200);
      expect(res.json().data.content).toBe("SESSION-SIDE-AGENT-DIR");
      await app.close();
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("E24 — git-root widening cannot reach credentials", () => {
  it("HOME is a git repo, the session cwd a subdirectory: the credential is refused, README.md still widens", async () => {
    try {
      execFileSync("git", ["init", "-q"], { cwd: home });
    } catch {
      return; // no git on this host: not observable here
    }
    write(path.join(home, "README.md"), "# readme");
    fs.mkdirSync(path.join(home, "sub"));
    sessionCwd = path.join(home, "sub");
    const app = await makeApp([path.join(home, "sub")]);
    expectPlainRefusal(await get(app, "proofed", fileUrl(path.join(home, "sub"), agent("auth.json"))), "path outside working directory");
    const readme = await get(app, "proofed", fileUrl(path.join(home, "sub"), path.join(home, "README.md")));
    expect(readme.statusCode).toBe(200);
    expect(readme.json().data.content).toBe("# readme");
    await app.close();
  });
});

describe("E25 — an access grant never admits a credential file", () => {
  it.each([["~/.pi/agent", () => agent()], ["$HOME", () => home], ["/", () => path.parse(home).root], ["~/.pi/dashboard", () => dash()]])(
    "grant over %s: credentials / token refused at every grant-consuming site; non-credential grant use unchanged",
    async (_label, subject) => {
      recordGrant({ subject: subject(), scope: "project", origin: "test" });
      write(agent("settings.json"), "SETTINGS");
      write(agent("skills", "x", "SKILL.md"), "# skill");
      const app = await makeApp([proj]);
      const refused: string[] = [agent("auth.json"), dash("local", "token")];
      for (const p of refused) {
        for (const route of ["/api/file", "/api/file/raw"]) {
          const res = await get(app, "proofed", fileUrl(proj, p, route));
          expect(res.statusCode, `${route} ${p}`).toBe(403);
          expect(res.body).not.toContain(MARK);
        }
        const sf = await get(app, "proofed", sessionFileUrl(p));
        expect(sf.statusCode, `session-file ${p}`).toBe(403);
        expect(sf.body).not.toContain(MARK);
        const mention = await post(app, "/api/file/resolve-mention", { cwd: proj, mention: p }, "proofed");
        expect(mention.json().data).toEqual({ resolved: null });
      }
      for (const p of [agent("settings.json"), agent("skills", "x", "SKILL.md")]) {
        const res = await get(app, "proofed", fileUrl(proj, p));
        expect(res.statusCode, p).toBe(200);
      }
      await app.close();
    },
  );
});

describe("X1–X4 / X7 — a credential swapped in after the path check is caught on the handle", () => {
  const sites: Array<[string, (app: FastifyInstance, file: string) => ReturnType<typeof get>, string, string]> = [
    ["GET /api/file", (app, f) => get(app, "proofed", fileUrl(proj, f)), "p.txt", "path outside working directory"],
    ["GET /api/file/raw", (app, f) => get(app, "proofed", fileUrl(proj, f, "/api/file/raw")), "p.txt", "path outside working directory"],
    ["GET /api/file/render", (app, f) => get(app, "proofed", fileUrl(proj, f, "/api/file/render")), "p.adoc", "path outside working directory"],
    ["GET /api/file/sheet", (app, f) => get(app, "proofed", fileUrl(proj, f, "/api/file/sheet")), "p.csv", "path outside working directory"],
    ["GET /api/file/digest", (app, f) => get(app, "proofed", fileUrl(proj, f, "/api/file/digest")), "p.txt", "path outside working directory"],
    ["GET /api/file/md-read", (app, f) => get(app, "proofed", fileUrl(proj, f, "/api/file/md-read")), "p.md", "path outside working directory"],
    ["GET /api/file/eml", (app, f) => get(app, "proofed", fileUrl(proj, f, "/api/file/eml")), "p.eml", "path outside working directory"],
    ["GET /api/file/eml-attachment", (app, f) => get(app, "proofed", `${fileUrl(proj, f, "/api/file/eml-attachment")}&index=0`), "p.eml", "path outside working directory"],
  ];

  for (const how of ["symlink", "hardlink"] as const) {
    it.each(sites)(`${how}: %s`, async (_site, call, name, error) => {
      const target = path.join(proj, name);
      write(target, "ordinary body");
      const swapped = swapOnOpen(target, how);
      const app = await makeApp([proj]);
      const res = await call(app, name);
      expect(swapped()).toBe(true);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ success: false, error });
      expect(res.body).not.toContain(MARK);
      expect(res.body).not.toMatch(/[0-9a-f]{40}/); // no digest of the credential either
      await app.close();
    });
  }
});

describe("X8 / X11 — grant reads and the artifact-root anchor", () => {
  it("X8 openVerifiedRegularFile refuses a hard link to a credential file with reason `state-file`", async () => {
    write(path.join(proj, "a.txt"), "x");
    fs.rmSync(path.join(proj, "a.txt"));
    fs.linkSync(agent("auth.json"), path.join(proj, "a.txt"));
    await expect(openVerifiedRegularFile(path.join(proj, "a.txt"))).rejects.toMatchObject({ name: "VerifiedReadRefused", reason: "state-file" });
    await expect(openVerifiedRegularFile(path.join(proj, "a.txt"))).rejects.toBeInstanceOf(VerifiedReadRefused);
    write(path.join(proj, "ok.txt"), "fine");
    const fh = await openVerifiedRegularFile(path.join(proj, "ok.txt"));
    await fh.close();
  });

  it.each([["a hard link already in the granted tree", false], ["a hard link swapped in after the check", true]])(
    "X8 every grant-admitted byte site refuses %s",
    async (_label, swap) => {
      const granted = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-granted-")));
      try {
        recordGrant({ subject: granted, scope: "project", origin: "test" });
        const app = await makeApp([proj]);
        const sites: Array<[string, string, (f: string) => string]> = [
          ["read", "a.txt", (f) => fileUrl(proj, f)],
          ["digest", "a.txt", (f) => fileUrl(proj, f, "/api/file/digest")],
          ["raw", "a.txt", (f) => fileUrl(proj, f, "/api/file/raw")],
          ["render", "a.adoc", (f) => fileUrl(proj, f, "/api/file/render")],
          ["sheet", "a.csv", (f) => fileUrl(proj, f, "/api/file/sheet")],
          ["eml", "a.eml", (f) => fileUrl(proj, f, "/api/file/eml")],
          ["eml-attachment", "a.eml", (f) => `${fileUrl(proj, f, "/api/file/eml-attachment")}&index=0`],
          ["session-file", "a.txt", (f) => sessionFileUrl(f)],
        ];
        for (const [label, name, url] of sites) {
          const target = path.join(granted, name);
          write(target, "granted body");
          let swapped = (): boolean => true;
          if (swap) swapped = swapOnOpen(target, "hardlink");
          else {
            fs.rmSync(target);
            fs.linkSync(agent("auth.json"), target);
          }
          const res = await get(app, "proofed", url(target));
          expect(swapped(), label).toBe(true);
          // A swap changes the inode between lstat and the handle (`handle-mismatch`): eml keeps its existing 400 shape
          // for that; a link that was already there reaches the `state-file` rule and answers the G2 403 everywhere.
          const expected = swap && label.startsWith("eml") ? 400 : 403;
          expect(res.statusCode, `${label} ${res.body}`).toBe(expected);
          expect(res.body, label).not.toContain(MARK);
          vi.restoreAllMocks();
        }
        await app.close();
      } finally {
        fs.rmSync(granted, { recursive: true, force: true });
      }
    },
  );

  it("X11 an artifact-root image hard-linked to a credential file is refused after open; a real PNG is still served", async () => {
    const artifactRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cred-artifacts-")));
    const prev = process.env.AGENT_BROWSER_SCREENSHOT_DIR;
    process.env.AGENT_BROWSER_SCREENSHOT_DIR = artifactRoot;
    resetArtifactRootsCache();
    try {
      fs.linkSync(agent("auth.json"), path.join(artifactRoot, "shot.png"));
      write(path.join(artifactRoot, "real.png"), "PNGDATA");
      const app = await makeApp([proj]);
      const bad = await get(app, "proofed", fileUrl(proj, path.join(artifactRoot, "shot.png"), "/api/file/raw"));
      expect(bad.statusCode).toBe(403);
      expect(bad.json()).toMatchObject({ success: false, error: "path outside working directory" });
      expect(bad.body).not.toContain(MARK);
      const good = await get(app, "proofed", fileUrl(proj, path.join(artifactRoot, "real.png"), "/api/file/raw"));
      expect(good.statusCode).toBe(200);
      expect(good.body).toBe("PNGDATA");
      await app.close();
    } finally {
      if (prev === undefined) delete process.env.AGENT_BROWSER_SCREENSHOT_DIR;
      else process.env.AGENT_BROWSER_SCREENSHOT_DIR = prev;
      resetArtifactRootsCache();
      fs.rmSync(artifactRoot, { recursive: true, force: true });
    }
  });
});

describe("E8 / E9 / P1 — grep", () => {
  afterEach(() => resetRipgrepCache());
  const rgBinary = (() => {
    try {
      return execFileSync("which", ["rg"], { encoding: "utf-8" }).trim() || null;
    } catch {
      return null;
    }
  })();
  const engines: Array<[string, string | null]> = [["JS fallback", null], ["ripgrep", rgBinary]];

  it("E8 the JS walker never reads a credential file (readFileSync spy) and returns no match from one", () => {
    write(path.join(home, "ordinary.txt"), `${MARK} ordinary`);
    fs.symlinkSync(agent("auth.json"), path.join(home, "l"));
    const real = fs.readFileSync;
    const read: string[] = [];
    (fs as { readFileSync: unknown }).readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      read.push(String(p));
      return (real as (...a: unknown[]) => unknown)(p, ...rest);
    }) as never;
    syncBuiltinESMExports();
    let matches: ReturnType<typeof grepWithJsScan>;
    try {
      matches = grepWithJsScan(home, MARK, { maxMatches: 50 });
    } finally {
      (fs as { readFileSync: unknown }).readFileSync = real;
      syncBuiltinESMExports();
    }
    const files = matches.map((m) => m.path);
    expect(files).toContain("ordinary.txt");
    expect(files.filter((f) => f.includes("auth.json") || f.includes("models.json") || f === "l")).toEqual([]);
    expect(read.some((p) => p.endsWith("ordinary.txt"))).toBe(true); // the spy really observes the walker
    for (const p of read) {
      for (const n of ["auth.json", "mcp-auth.json", "providers.json", "plugin-credentials.json", "models.json", "mcp.json"]) {
        expect(p.endsWith(`${path.sep}agent${path.sep}${n}`), p).toBe(false);
      }
    }
  });

  it.each(engines)("E8 %s: /api/grep (cwd = $HOME) returns no credential match, ordinary matches stay", async (name, rg) => {
    if (name === "ripgrep" && !rg) return; // no ripgrep on this host: not observable here
    resetRipgrepCache();
    detectRipgrep(() => rg);
    if (rg) vi.spyOn(process, "cwd").mockReturnValue(home); // parseRipgrepJson relativizes rg's `./x` against process.cwd() (pre-existing)
    sessionCwd = home;
    write(path.join(home, "ordinary.txt"), `${MARK} ordinary`);
    fs.symlinkSync(agent("auth.json"), path.join(home, "l"));
    const app = await makeApp([home]);
    const res = await get(app, "proofed", `/api/grep?cwd=${q(home)}&q=${MARK}`);
    expect(res.statusCode).toBe(200);
    const files = (res.json().data.matches as Array<{ path: string }>).map((m) => m.path);
    expect(files.filter((f) => /(^|\/)(auth|mcp-auth|providers|plugin-credentials|models|mcp)\.json/.test(f) || f === "l")).toEqual([]);
    expect(files).toContain("ordinary.txt");
    await app.close();
  });

  it.each(engines)("E9 %s: hard links to credential / state files are dropped; the ordinary match is kept", async (name, rg) => {
    if (name === "ripgrep" && !rg) return;
    resetRipgrepCache();
    detectRipgrep(() => rg);
    if (rg) vi.spyOn(process, "cwd").mockReturnValue(proj); // see E8: pre-existing rg path relativization
    write(agent("auth.json.corrupt-20260101T000000Z"), MARK);
    fs.linkSync(agent("auth.json"), path.join(proj, "link-a.txt"));
    fs.linkSync(agent("auth.json.corrupt-20260101T000000Z"), path.join(proj, "link-b.txt"));
    fs.linkSync(dash("local", "token"), path.join(proj, "link-c.txt"));
    fs.linkSync(dash("identity.key"), path.join(proj, "link-d.txt"));
    write(path.join(proj, "ok.txt"), `${MARK} ordinary`);
    const app = await makeApp([proj]);
    const res = await get(app, "proofed", `/api/grep?cwd=${q(proj)}&q=${MARK}`);
    expect(res.statusCode).toBe(200);
    const files = (res.json().data.matches as Array<{ path: string }>).map((m) => m.path);
    expect(files).toEqual(["ok.txt"]); // count equals the count without the links
    await app.close();
  });

  it.each([
    ["40 distinct files × 6 lines", 40, 6],
    ["300 distinct files × 1 line", 300, 1],
  ])("P1 identity filter cost, %s: ≤ one stat per distinct matched path; identity list built once", async (_label, files, lines) => {
    resetRipgrepCache();
    detectRipgrep(() => null);
    for (let i = 0; i < files; i++) write(path.join(proj, `f${i}.txt`), Array.from({ length: lines }, () => MARK).join("\n"));
    const app = await makeApp([proj]);
    const realStat = fsp.stat.bind(fsp);
    const realReaddir = fsp.readdir.bind(fsp);
    const statsInProj: string[] = [];
    let agentListings = 0;
    vi.spyOn(fsp, "stat").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p).startsWith(proj)) statsInProj.push(String(p));
      return (realStat as (...a: unknown[]) => Promise<fs.Stats>)(p, ...rest);
    }) as never);
    vi.spyOn(fsp, "readdir").mockImplementation((async (p: fs.PathLike, ...rest: unknown[]) => {
      if (String(p) === agent()) agentListings++;
      return (realReaddir as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as never);
    const res = await get(app, "proofed", `/api/grep?cwd=${q(proj)}&q=${MARK}`);
    expect(res.statusCode).toBe(200);
    const matches = res.json().data.matches as Array<{ path: string }>;
    const distinct = new Set(matches.map((m) => m.path)).size;
    expect(distinct).toBeGreaterThan(0);
    expect(distinct).toBeLessThanOrEqual(Math.min(files, 500));
    expect(statsInProj.length).toBeLessThanOrEqual(distinct); // structural budget only, no wall time
    expect(agentListings).toBe(1); // identity list built exactly once per request
    await app.close();
  });
});
