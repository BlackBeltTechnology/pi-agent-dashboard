/**
 * The self-describing denial body, end to end through the real routes (change:
 * surface-denial-remedy-in-previews, design D5/D6; test-plan #E1-#E4, #E6-#E14,
 * #X3, #X5).
 *
 * Modelled on `access-grant-denial-sites.test.ts`: the coordinator is installed
 * with REAL planes; only the operator is simulated, by answering the broadcast
 * `grant_request` through `onResponse`. `app.inject` defaults to a loopback
 * peer with no forwarding header, so a request is genuinely local unless it sets
 * `remoteAddress`.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPathDenials, __resetPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants, listGrants } from "../access/access-grants.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import type { HostGateMode } from "../access/prompt-channel.js";
import { createFilesystemPlane } from "../access/planes.js";
import { __resetPromptChannels, GRANT_CHANNEL_HEADER, issuePromptChannel } from "../access/prompt-channel.js";
import { registerAccessRoutes } from "../routes/access-routes.js";
import { registerFileRoutes } from "../routes/file-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";

let tmp: string;
let cwd: string;
let outside: string;
let sent: ServerToBrowserMessage[];
let coordinator: GrantCoordinator;
let capability: string;
let promptEnabled: boolean;
let hostGate: HostGateMode;
let savedHome: string | undefined;

function makeCoordinator(planes = defaultPlanes()): GrantCoordinator {
  return new GrantCoordinator({
    planes,
    broadcast: (m) => sent.push(m),
    hostGateMode: () => hostGate,
    promptEnabled: () => promptEnabled,
    killSwitch: () => false,
    operatorChannels: () => 1,
    onTransition: () => {},
  });
}

function defaultPlanes(): AccessPlaneRegistry {
  const planes = new AccessPlaneRegistry();
  planes.register(createFilesystemPlane());
  return planes;
}

function makeApp(opts: { systemOpenCapable?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [{ cwd }] } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
    systemOpen: { capable: () => opts.systemOpenCapable ?? false, run: () => {} },
  });
  return app;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-outcome-")));
  cwd = path.join(tmp, "session");
  outside = path.join(tmp, "outside");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.join(outside, "d"), { recursive: true });
  fs.writeFileSync(path.join(outside, "d", "a.png"), "png-a");
  fs.writeFileSync(path.join(outside, "d", "b.png"), "png-b");
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  __resetAccessGrants();
  __resetPathDenials();
  sent = [];
  promptEnabled = true;
  hostGate = "enforce";
  savedHome = process.env.HOME;
  coordinator = makeCoordinator();
  installGrantCoordinator(coordinator);
  capability = issuePromptChannel("operator-sock");
});

afterEach(() => {
  installGrantCoordinator(null);
  __resetPromptChannels();
  process.env.HOME = savedHome;
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  __resetPathDenials();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const q = (file: string) => `cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(file)}`;

type Caller = { cap?: string | null; remote?: string };
const get = (app: FastifyInstance, url: string, caller: Caller = {}) =>
  app.inject({
    method: "GET",
    url,
    headers: caller.cap === undefined || caller.cap === null ? {} : { [GRANT_CHANNEL_HEADER]: caller.cap },
    ...(caller.remote ? { remoteAddress: caller.remote } : {}),
  });

const raw = (app: FastifyInstance, file: string, caller: Caller = {}) => get(app, `/api/file/raw?${q(file)}`, caller);

async function nextPrompt(seen = 0) {
  for (let i = 0; i < 200; i++) {
    const prompts = sent.filter((m) => m.type === "grant_request");
    if (prompts.length > seen) {
      const p = prompts[seen];
      if (p.type === "grant_request") return p;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no grant_request was broadcast");
}

const answer = (p: { promptId: string; plane: string; subject: string }, verdict: string) =>
  coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict });

describe("D6: the body names exactly what a grant would store", () => {
  it("#E1 a symlinked directory is named by its real path, in the body and the recorded denial", async () => {
    installGrantCoordinator(null);
    fs.symlinkSync(path.join(outside, "d"), path.join(outside, "link"));
    const res = await raw(makeApp(), path.join(outside, "link", "a.png"));
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.subject).toBe(fs.realpathSync(path.join(outside, "d")));
    const recorded = listPathDenials().find((d) => d.denialId === body.denialId);
    expect(recorded?.subject).toBe(body.subject);
  });

  it("#E2 the body and the dialog name the same subject", async () => {
    fs.symlinkSync(path.join(outside, "d"), path.join(outside, "link"));
    const pending = raw(makeApp(), path.join(outside, "link", "a.png"), { cap: capability });
    const p = await nextPrompt();
    await answer(p, "deny");
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(p.subject).toBe(res.json().subject);
  });

  it("#E3 a canonical body subject still binds a grant through the grant endpoint", async () => {
    installGrantCoordinator(null);
    fs.symlinkSync(path.join(outside, "d"), path.join(outside, "link"));
    const app = makeApp();
    registerAccessRoutes(app, {
      networkGuard: async () => undefined,
      preferencesStore: { getPinnedDirectories: () => [], unpinDirectory: () => {} } as never,
      writeConfigPartial: () => ({ success: true }),
    });
    const body = (await raw(app, path.join(outside, "link", "a.png"))).json();
    const granted = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: body.denialId, subject: body.subject, scope: "session" },
    });
    expect(granted.statusCode).toBe(200);
    const list = (await app.inject({ method: "GET", url: "/api/access/grants" })).json();
    expect(list.data.pathGrants.map((g: { subject: string }) => g.subject)).toContain(
      fs.realpathSync(path.join(outside, "d")),
    );
  });

  it("#E4 a refused path under a regular file names that file's real path, not its directory", async () => {
    installGrantCoordinator(null);
    const notes = path.join(outside, "d", "notes.txt");
    fs.writeFileSync(notes, "n");
    const body = (await raw(makeApp(), path.join(notes, "x"))).json();
    expect(body.subject).toBe(fs.realpathSync(notes));
    expect(body.subject).not.toBe(fs.realpathSync(path.join(outside, "d")));
  });
});

describe("D5: promptOutcome, decided in the gate", () => {
  const sheet = (app: FastifyInstance, file: string, caller: Caller = {}) =>
    get(app, `/api/file/sheet?${q(file)}`, caller);

  it("#E6 ungrantable wins at a holdless site", async () => {
    const home = path.join(outside, "d", "home");
    fs.mkdirSync(home);
    process.env.HOME = home; // `outside/d` now contains $HOME: ungrantable
    const res = await sheet(makeApp(), path.join(outside, "d", "x.xlsx"));
    expect(res.statusCode).toBe(403);
    expect(res.json().promptOutcome).toBe("ungrantable");
  });

  it("#E7 a holdless site reports cannot-ask", async () => {
    const res = await sheet(makeApp(), path.join(outside, "d", "x.xlsx"));
    expect(res.statusCode).toBe(403);
    expect(res.json().promptOutcome).toBe("cannot-ask");
  });

  it("#E8 disclosure is withheld from a caller that is neither authenticated nor genuinely local", async () => {
    const app = makeApp();
    registerSessionRoutes(app, {
      sessionManager: { get: (id: string) => (id === "s1" ? { id, cwd } : undefined), listAll: () => [] } as never,
      eventStore: {} as never,
      networkGuard: async () => undefined,
    } as never);
    const remote = { remote: "10.1.2.3" };
    const d = path.join(outside, "d");
    const urls = [
      `/api/file?${q(path.join(d, "a.png"))}`,
      `/api/file/tree?${q(d)}`,
      `/api/file/exists?${q(path.join(d, "a.png"))}`,
      `/api/file/raw?${q(path.join(d, "a.png"))}`,
      `/api/file/render?${q(path.join(d, "x.adoc"))}`,
      `/api/file/sheet?${q(path.join(d, "x.xlsx"))}`,
      `/api/file/eml?${q(path.join(d, "x.eml"))}`,
      `/api/file/rendered-pdf?${q(path.join(d, "x.docx"))}`,
      `/api/session-file?sessionId=s1&path=${encodeURIComponent(path.join(d, "a.png"))}`,
    ];
    for (const url of urls) {
      const res = await get(app, url, remote);
      expect(res.statusCode, url).toBe(403);
      const body = res.json();
      expect(body.denialId, url).toEqual(expect.any(String));
      expect(Object.hasOwn(body, "promptOutcome"), url).toBe(false);
    }
    // Sanity: the same site DOES disclose to a genuinely local caller.
    const local = await get(app, `/api/session-file?sessionId=s1&path=${encodeURIComponent(path.join(d, "a.png"))}`);
    expect(local.json().promptOutcome).toBe("ineligible");
  });

  it("#E9 off vs not-enforced", async () => {
    promptEnabled = false;
    expect((await raw(makeApp(), path.join(outside, "d", "a.png"), { cap: capability })).json().promptOutcome).toBe(
      "off",
    );
    promptEnabled = true;
    hostGate = "report";
    expect((await raw(makeApp(), path.join(outside, "d", "b.png"), { cap: capability })).json().promptOutcome).toBe(
      "not-enforced",
    );
  });

  it("#E10 recently answered: no second dialog inside the backoff", async () => {
    const app = makeApp();
    const pending = raw(app, path.join(outside, "d", "a.png"), { cap: capability });
    await answer(await nextPrompt(), "allow-once");
    expect((await pending).statusCode).toBe(200);
    const again = await raw(app, path.join(outside, "d", "b.png"), { cap: capability });
    expect(again.statusCode).toBe(403);
    expect(again.json().promptOutcome).toBe("recently-answered");
    expect(sent.filter((m) => m.type === "grant_request")).toHaveLength(1);
  });

  it("#E11 a joiner reports its own eligibility, not the entry's", async () => {
    const app = makeApp();
    // Two dialogs from two other operator sockets fill the global cap.
    for (const [sock, dir] of [
      ["sock-2", "x"],
      ["sock-3", "y"],
    ] as const) {
      fs.mkdirSync(path.join(outside, dir));
      void raw(app, path.join(outside, dir, "f.png"), { cap: issuePromptChannel(sock) });
    }
    const x = await nextPrompt(0);
    const y = await nextPrompt(1);
    // An eligible request for D is suppressed by the cap: recorded, unprompted.
    const suppressed = await raw(app, path.join(outside, "d", "a.png"), { cap: capability });
    expect(suppressed.json().promptOutcome).toBe("busy");
    // A declared-ineligible read of another file in D joins that entry.
    const joined = await raw(app, path.join(outside, "d", "b.png"), { cap: "" });
    expect(joined.statusCode).toBe(403);
    expect(joined.json().promptOutcome).toBe("ineligible");
    await answer(x, "deny");
    await answer(y, "deny");
  });

  it("#E12 an allow the re-evaluation refuses is allowed-but-refused", async () => {
    const d = path.join(outside, "d");
    const elsewhere = path.join(tmp, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "a.png"), "other");
    const pending = raw(makeApp(), path.join(d, "a.png"), { cap: capability });
    const p = await nextPrompt();
    fs.renameSync(d, `${d}-old`);
    fs.symlinkSync(elsewhere, d);
    await answer(p, "allow-once");
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(res.json().promptOutcome).toBe("allowed-but-refused");
  });

  it("#E13 a holdless body keeps its keys and values, and carries the outcome", async () => {
    const res = await get(makeApp(), `/api/file/eml?${q(path.join(outside, "d", "x.eml"))}`);
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(Object.keys(body)).toEqual([
      "success",
      "error",
      "reason",
      "hint",
      "subject",
      "denialId",
      "ancestors",
      "promptOutcome",
    ]);
    expect(body).toMatchObject({
      success: false,
      error: "path outside working directory",
      reason: "Path is outside every containment anchor for this session.",
      hint: "Grant access to this directory from the denial's remedy, or open the file from a session rooted in it.",
      subject: fs.realpathSync(path.join(outside, "d")),
      promptOutcome: "cannot-ask",
    });
  });

  it("#E14 no remedy, no outcome (allowGrant:false)", async () => {
    const res = await makeApp({ systemOpenCapable: true }).inject({
      method: "POST",
      url: "/api/open-in-system",
      headers: { origin: "http://localhost:8000" },
      payload: { cwd, path: path.join(outside, "d", "a.png") },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(Object.hasOwn(body, "denialId")).toBe(false);
    expect(Object.hasOwn(body, "promptOutcome")).toBe(false);
  });

  it("#X3 a grant write that fails reports grant-failed, and nothing is listed", async () => {
    const planes = new AccessPlaneRegistry();
    const fsPlane = createFilesystemPlane();
    planes.register({
      ...fsPlane,
      grant: async () => ({ ok: false as const, reason: "write-failed", error: "disk full" }),
    });
    coordinator = makeCoordinator(planes);
    installGrantCoordinator(coordinator);
    const pending = raw(makeApp(), path.join(outside, "d", "a.png"), { cap: capability });
    await answer(await nextPrompt(), "allow-always");
    const res = await pending;
    expect(res.statusCode).toBe(403);
    expect(res.json().promptOutcome).toBe("grant-failed");
    expect(listGrants()).toEqual([]);
  });

  it("#X5 no coordinator installed reports off", async () => {
    installGrantCoordinator(null);
    const res = await raw(makeApp(), path.join(outside, "d", "a.png"));
    expect(res.json().promptOutcome).toBe("off");
  });
});
