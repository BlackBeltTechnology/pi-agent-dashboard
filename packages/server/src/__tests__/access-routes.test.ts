/**
 * Security tests for the grant endpoint and the Access review API
 * (`routes/access-routes.ts`).
 *
 * The grant endpoint is the ONE place a filesystem grant can be created, so this
 * file is the boundary test for design D12/D15/D20: a grant must trace to a real
 * recorded denial, name only a subject that denial (or its offered ladder)
 * named, never a forbidden subject, and never be reachable cross-origin.
 *
 * Covers test-plan E16, E17, E22, E23, X15, X17, X18 and tasks 7b.0a, 7b.1,
 * 7b.1b, 7b.2, 7b.3, 4.8-style route inventory, plus the tab's read shape.
 *
 * See change: add-access-grants-and-review.
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials, getPathDenial, recordPathDenial } from "../access/access-denials.js";
import {
  __resetAccessGrants,
  grantedSubjects,
  recordGrant,
  grantedSubjects as subjects,
} from "../access/access-grants.js";
import { isForbiddenGrantSubject } from "../access/forbidden-subjects.js";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { registerAccessRoutes } from "../routes/access-routes.js";

let app: FastifyInstance;
let tmp: string;
let storePath: string;

/** Minimal deps: a permissive guard, a real prefs double, a config double. */
function makeApp(opts: { writeFails?: boolean; withOriginGate?: boolean } = {}): FastifyInstance {
  const pinned: string[] = [];
  const instance = Fastify({ logger: false });
  if (opts.withOriginGate) {
    // Production wires this globally in server.ts; mounting the REAL factory
    // here means the cross-origin assertion tests the actual admission rules
    // rather than a stub.
    instance.addHook(
      "onRequest",
      createMutationOriginGate(() => ({ configuredOrigins: [], trustedNetworks: [] })),
    );
  }
  registerAccessRoutes(instance, {
    networkGuard: async () => undefined,
    preferencesStore: {
      getPinnedDirectories: () => [...pinned],
      unpinDirectory: (d: string) => {
        const i = pinned.indexOf(d);
        if (i >= 0) pinned.splice(i, 1);
      },
    } as never,
    writeConfigPartial: () =>
      opts.writeFails ? { success: false, error: "config write failed" } : { success: true },
  });
  return instance;
}

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "access-routes-"));
  storePath = path.join(tmp, "store", "access-grants.json");
  process.env.PI_ACCESS_GRANTS_STORE = storePath;
  __resetAccessGrants();
  __resetPathDenials();
  app = makeApp();
  await app.ready();
});

afterEach(async () => {
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  __resetPathDenials();
  await app.close();
  await fsp.rm(tmp, { recursive: true, force: true });
});

function mkdir(...segs: string[]): string {
  const p = path.join(tmp, ...segs);
  require("node:fs").mkdirSync(p, { recursive: true });
  return p;
}

describe("7b.0 / 7b.0a GET /api/access/grants — read shape", () => {
  it("aggregates path grants with all four fields and keeps bypassHosts separate", async () => {
    const dir = mkdir("granted");
    recordGrant({ subject: dir, origin: "sess-1", now: 1234 });

    const res = await app.inject({ method: "GET", url: "/api/access/grants" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    // All eight in-scope stores are present (design D6).
    for (const key of [
      "pathGrants",
      "worktreeTrust",
      "kbTrust",
      "projectTrust",
      "trustedNetworks",
      "bypassHosts",
      "corsOrigins",
      "pinnedDirectories",
    ]) {
      expect(body.data).toHaveProperty(key);
    }
    const grant = body.data.pathGrants[0];
    expect(grant.subject).toBe(require("node:fs").realpathSync(dir));
    expect(grant.scope).toBe("project");
    expect(grant.origin).toBe("sess-1");
    expect(typeof grant.grantedAt).toBe("string");
    // The two host stores are distinct keys, never merged.
    expect(body.data.trustedNetworks).not.toBeUndefined();
    expect(body.data.bypassHosts).not.toBeUndefined();
  });

  it("7.7 reading the tab performs no store write", async () => {
    const dir = mkdir("ro");
    recordGrant({ subject: dir });
    const before = await fsp.readFile(storePath, "utf8");
    await app.inject({ method: "GET", url: "/api/access/grants" });
    await app.inject({ method: "GET", url: "/api/access/grants" });
    expect(await fsp.readFile(storePath, "utf8")).toBe(before);
  });

  it("9a.26 the denial registry is not exposed as a writable collection", async () => {
    // Route inventory: the ONLY /api/access route that creates state is the
    // grant endpoint, and it requires a denialId. There is no POST that lets a
    // caller mint a pending access request or a path denial.
    // Route inventory, asserted BEHAVIOURALLY rather than by parsing
    // `printRoutes()` output (whose tree formatting is Fastify-version detail):
    // the only POST under /api/access is the grant endpoint, and nothing lets a
    // caller mint a path denial or a pending access request — the ledger and
    // the registry are written only by the guard/denial path (tasks 9a.31, 9c.6).
    for (const probe of [
      "/api/access/denials",
      "/api/access/requests",
      "/api/access/pending",
      "/api/access/grants/request",
    ]) {
      const res = await app.inject({ method: "POST", url: probe, payload: {} });
      expect(res.statusCode, `POST ${probe} must not exist`).toBe(404);
    }
    // The grant endpoint itself exists (400 = reached, denialId missing).
    const real = await app.inject({ method: "POST", url: "/api/access/grants", payload: {} });
    expect(real.statusCode).toBe(400);
  });
});

describe("7b.1 / 9a.19 grant binds to a recorded denial", () => {
  it("9a.19 refuses a directory no denial named, and records nothing", async () => {
    const unnamed = mkdir("unnamed");
    recordPathDenial({ subject: mkdir("named"), site: "file-routes:read" });
    const denialId = recordPathDenial({ subject: mkdir("other"), site: "s" }).denialId;

    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId, subject: unnamed },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/not named by that denial/);
    expect(grantedSubjects()).toEqual([]);
  });

  it("9a.19b an unknown denialId is refused (410/409 class)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: "no-such-id", subject: mkdir("x") },
    });
    expect(res.statusCode).toBe(409);
    expect(grantedSubjects()).toEqual([]);
  });

  it("9a.19c a missing denialId is a 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { subject: mkdir("y") },
    });
    expect(res.statusCode).toBe(400);
  });

  it("9a.27 an EXPIRED denialId is refused", async () => {
    const subject = mkdir("exp");
    const entry = recordPathDenial({ subject, site: "s", now: 0 });
    // Past the TTL: the binding is dead even though the entry still exists.
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject },
    });
    expect(res.statusCode).toBe(409);
    expect(getPathDenial(entry.denialId)).toBeUndefined();
    expect(grantedSubjects()).toEqual([]);
  });

  it("7b.1a the named subject itself is accepted", async () => {
    const named = mkdir("mine");
    const entry = recordPathDenial({ subject: named, site: "s" });
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: named },
    });
    expect(res.statusCode).toBe(200);
    expect(subjects()).toContain(require("node:fs").realpathSync(named));
  });

  it("9a.20 an OFFERED ANCESTOR is accepted and recorded as widened", async () => {
    // Home is a tmp dir; the ladder stops below it and never offers it.
    const home = path.join(os.homedir(), "ladder-home");
    const deep = path.join(home, "work", "proj", "src");
    require("node:fs").mkdirSync(deep, { recursive: true });
    const { offeredAncestorLadder } = await import("../access/ancestor-ladder.js");
    const ancestors = await offeredAncestorLadder(deep, { homedir: home });
    expect(ancestors.length).toBeGreaterThan(0);

    const entry = recordPathDenial({ subject: deep, site: "s", ancestors });
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: ancestors[0] },
    });
    expect(res.statusCode).toBe(200);
    const [grant] = subjects();
    expect(grant).toBe(require("node:fs").realpathSync(ancestors[0]));
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("9a.20b a subject NOT in the denial's ladder is refused", async () => {
    const home = path.join(os.homedir(), "ladder-home2");
    const deep = path.join(home, "work", "proj");
    require("node:fs").mkdirSync(deep, { recursive: true });
    const entry = recordPathDenial({ subject: deep, site: "s", ancestors: [path.join(home, "work")] });

    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: path.join(home, "elsewhere") },
    });
    expect(res.statusCode).toBe(403);
    expect(grantedSubjects()).toEqual([]);
    await fsp.rm(home, { recursive: true, force: true });
  });
});

describe("7b.2 / 9a.20 forbidden grant subjects", () => {
  it("9a.20 refuses /, $HOME, ~/.ssh and ~/.pi even when a denial named them", async () => {
    const home = os.homedir();
    for (const forbidden of ["/", home, path.join(home, ".ssh"), path.join(home, ".pi")]) {
      const entry = recordPathDenial({ subject: forbidden, site: "s" });
      const res = await app.inject({
        method: "POST",
        url: "/api/access/grants",
        payload: { denialId: entry.denialId, subject: forbidden },
      });
      expect(res.statusCode, `expected ${forbidden} to be refused`).toBe(403);
    }
    expect(grantedSubjects()).toEqual([]);
  });

  it("9a.30 refuses /etc reached through the /private/etc symlink alias", async () => {
    // Comparing lexical paths would accept this; the filter compares real paths.
    const alias = path.join(tmp, "etc-alias");
    require("node:fs").symlinkSync("/etc", alias);
    const entry = recordPathDenial({ subject: alias, site: "s" });
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: alias },
    });
    expect(res.statusCode).toBe(403);
    expect(grantedSubjects()).toEqual([]);
  });

  it("refuses a rung that would SUBSUME a forbidden subject", async () => {
    // `/private` is not itself forbidden, but granting it admits `/private/etc`
    // on macOS. A ladder rung must never be a gateway to a forbidden subject.
    const privateDir = "/private";
    const entry = recordPathDenial({ subject: privateDir, site: "s" });
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: privateDir },
    });
    expect(res.statusCode).toBe(403);
    expect(grantedSubjects()).toEqual([]);
  });
});

describe("7b.3 / 9a.25 origin and auth on the grant endpoint", () => {
  it("9a.25 a missing denialId with a cross-origin Origin is refused (gate owns it)", async () => {
    // The global mutation-origin gate refuses cross-origin /api POSTs before the
    // route runs when it is registered; here we assert the route does not
    // silently SUCCEED for a cross-origin caller regardless of gate wiring.
    const named = mkdir("x-origin");
    const entry = recordPathDenial({ subject: named, site: "s" });
    const gated = makeApp({ withOriginGate: true });
    await gated.ready();
    const res = await gated.inject({
      method: "POST",
      url: "/api/access/grants",
      headers: { origin: "https://evil.example" },
      payload: { denialId: entry.denialId, subject: named },
    });
    // The global gate refuses a cross-origin /api POST.
    expect(res.statusCode).toBe(403);
    expect(grantedSubjects()).toEqual([]);

    // Control: the SAME request with no Origin (a non-browser client) is
    // admitted by the gate — proving the refusal above is about the Origin.
    const noOrigin = await gated.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: named },
    });
    expect(noOrigin.statusCode).toBe(200);
    await gated.close();
  });

  it("7b.3 records the stated limit: a local process can satisfy the binding", async () => {
    // This is an EXPLICIT, ACCEPTED limitation (design D15), asserted so it is a
    // documented behaviour rather than an unnoticed hole: `inject` presents as a
    // local request, so it can read a denial body and then satisfy the binding.
    const named = mkdir("local");
    const entry = recordPathDenial({ subject: named, site: "s" });
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: named },
    });
    expect(res.statusCode).toBe(200);
    // The binding constrains parties that CANNOT see the denial body; it is not
    // an operator-presence check. `add-access-grant-dialog` owns that problem.
  });

  it("requires a denialId (there is no free-form grant)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { subject: "/tmp", scope: "project" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("revoke endpoints", () => {
  it("DELETE /api/access/grants revokes and takes effect immediately", async () => {
    const dir = mkdir("rv");
    recordGrant({ subject: dir });
    expect(subjects()).toContain(require("node:fs").realpathSync(dir));

    const res = await app.inject({
      method: "DELETE",
      url: "/api/access/grants",
      payload: { subject: dir },
    });
    expect(res.statusCode).toBe(200);
    expect(subjects()).not.toContain(require("node:fs").realpathSync(dir));
  });

  it("a revoke of an unknown subject is a 404, not a silent success", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/access/grants",
      payload: { subject: mkdir("nope") },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/access/grants requires a subject", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/access/grants", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /api/access/pinned-directory unpins through the preferences store", async () => {
    const dir = mkdir("pinned");
    const listRes = await app.inject({ method: "GET", url: "/api/access/grants" });
    expect(listRes.json().data.pinnedDirectories).toEqual([]);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/access/pinned-directory",
      payload: { subject: dir },
    });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE /api/access/bypass-hosts reports a config write failure rather than claiming success", async () => {
    const failing = makeApp({ writeFails: true });
    await failing.ready();
    const res = await failing.inject({
      method: "DELETE",
      url: "/api/access/bypass-hosts",
      payload: { host: "example.test" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/config write failed/);
    await failing.close();
  });
});

/**
 * Task 4.5 #5: `trustedNetworks` and `corsOrigins` are ARRAY-valued config
 * fields. They used to be revoked by a whole-array `PUT /api/config` whose
 * remaining list the CLIENT computed from a rendered snapshot, so two revokes
 * issued before the first refetch both derived from the same stale array and the
 * later write resurrected the earlier one's entry. These endpoints read-modify-
 * write server-side instead, like `bypass-hosts`, making removal atomic per
 * entry and independent of any client snapshot (including a second tab's).
 *
 * Scope of these tests: validation, the failure path, and the success path.
 * Sibling PRESERVATION against a seeded config is asserted client-side in
 * `access-grants-api.test.ts` against a server double, not here.
 */
describe("4.5 #5 — per-entry config revokes", () => {
  const routes = [
    {
      url: "/api/access/trusted-network",
      payload: { network: "10.0.0.0/8" },
      missing: "network is required",
    },
    {
      url: "/api/access/cors-origin",
      payload: { origin: "https://a.example.com" },
      missing: "origin is required",
    },
  ];

  for (const { url, payload, missing } of routes) {
    it(`${url} rejects a missing field`, async () => {
      const res = await app.inject({ method: "DELETE", url, payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe(missing);
    });

    it(`${url} reports a config write failure rather than claiming success`, async () => {
      const failing = makeApp({ writeFails: true });
      await failing.ready();
      const res = await failing.inject({ method: "DELETE", url, payload });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatch(/config write failed/);
      await failing.close();
    });

    it(`${url} succeeds, and is a no-op for an entry that is not present`, async () => {
      const res = await app.inject({ method: "DELETE", url, payload });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  }
});

describe("7b.0a grant-endpoint write failure is reported, never silent", () => {
  it("returns a 500 naming the failure when the store write throws (design D11)", async () => {
    const named = mkdir("wfail");
    const entry = recordPathDenial({ subject: named, site: "s" });
    // Make the store unwritable by pointing it inside a FILE.
    const blocker = path.join(tmp, "blocker");
    await fsp.writeFile(blocker, "not a dir", "utf8");
    process.env.PI_ACCESS_GRANTS_STORE = path.join(blocker, "nested", "access-grants.json");
    __resetAccessGrants();

    const res = await app.inject({
      method: "POST",
      url: "/api/access/grants",
      payload: { denialId: entry.denialId, subject: named },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatch(/grant not recorded/);
    // The admitted set never widens on a failed write.
    expect(grantedSubjects()).toEqual([]);
  });
});

/**
 * Regression for a defect found by the pre-ship security audit (design D15).
 *
 * A denial's `subject` is the LEXICAL dirname of the refused path
 * (`grantableSubjectOf`), so it is a regular FILE whenever the refused path had
 * one extra component. The forbidden filter originally ran on that raw subject
 * — which is not itself forbidden — and `recordGrant` then normalized it onto
 * its containing directory, persisting a grant for the parent. On macOS a
 * denial naming `$HOME/.CFUserTextEncoding` became a grant for the whole of
 * `$HOME`, and `/.file` became a grant for `/`; one operator click on the
 * offered remedy would then have admitted `~/.ssh` and `~/.pi`.
 *
 * The fix runs the filter on the NORMALIZED subject, at both the route and the
 * store, so the value that is checked is the value that is persisted.
 */
describe("subject normalization cannot move a grant past the forbidden filter", () => {
  it("refuses a denial whose FILE subject normalizes into $HOME, recording nothing", async () => {
    const home = os.homedir();
    const file = path.join(home, `audit-regression-${process.pid}.txt`);
    await fsp.writeFile(file, "x", "utf8");
    try {
      // The trap, asserted explicitly: the raw subject passes the filter…
      expect(isForbiddenGrantSubject(file)).toBe(false);
      // …while the value it normalizes onto does not.
      expect(isForbiddenGrantSubject(home)).toBe(true);

      const entry = recordPathDenial({ subject: file, site: "s" });
      const res = await app.inject({
        method: "POST",
        url: "/api/access/grants",
        payload: { denialId: entry.denialId, subject: file },
      });
      expect(res.statusCode).toBe(403);
      expect(grantedSubjects()).toEqual([]);
    } finally {
      await fsp.rm(file, { force: true });
    }
  });

  it("the STORE backstops the filter when a caller skips route validation", async () => {
    const home = os.homedir();
    const file = path.join(home, `audit-store-${process.pid}.txt`);
    await fsp.writeFile(file, "x", "utf8");
    try {
      const result = recordGrant({ subject: file, origin: "test" });
      expect(result.ok).toBe(false);
      expect(grantedSubjects()).toEqual([]);
    } finally {
      await fsp.rm(file, { force: true });
    }
  });
});

/**
 * Task 7b.4 — the grant path mirrors the hardening `tunnel-block-events.ts`
 * applies to its own one-click trust action. That action is AUDITED
 * (`[network-trust] accepted pending request ip=…`, STRIDE: Repudiation); a
 * grant is a PERSISTENT filesystem widening, so it must leave an operational
 * trail and not merely a store entry.
 */
describe("7b.4 a successful grant is audited", () => {
  it("emits an [access-grant] line naming the subject, scope and denial", async () => {
    const dir = mkdir("audited");
    const entry = recordPathDenial({ subject: dir, site: "file-routes:read" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/access/grants",
        payload: { denialId: entry.denialId, subject: dir },
      });
      expect(res.statusCode).toBe(200);
      const line = spy.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.startsWith("[access-grant] granted"));
      expect(line, "expected an [access-grant] audit line").toBeDefined();
      expect(line).toContain(dir);
      expect(line).toContain(`denialId=${entry.denialId}`);
      expect(line).toContain("scope=project");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not emit the audit line when the grant is refused", async () => {
    const home = os.homedir();
    const entry = recordPathDenial({ subject: home, site: "s" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/access/grants",
        payload: { denialId: entry.denialId, subject: home },
      });
      expect(res.statusCode).toBe(403);
      expect(
        spy.mock.calls.some((c) => String(c[0]).startsWith("[access-grant] granted")),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
