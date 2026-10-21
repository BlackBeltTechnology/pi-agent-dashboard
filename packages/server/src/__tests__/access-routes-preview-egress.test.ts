/**
 * Settings → Access: the preview-egress store (list + revoke).
 *  E28 list row `{store:"preview-egress", project}`; revoke takes effect on the next CSP build, no restart
 *  E29 a missing or malformed store lists as empty: 200, no throw, the file is not rewritten
 *
 * See change: improve-canvas-html-and-url-ux (tasks 3.4, 3.7, 3.8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectEgressGrants, resetPreviewEgressCache } from "../access/preview-egress-store.js";
import { buildLiveCsp } from "../live-server/live-csp.js";
import { createPreviewEgress } from "../live-server/live-egress.js";
import { registerAccessRoutes } from "../routes/access-routes.js";

const CDN = "https://cdn.tailwindcss.com";
let tmp: string;
let storeFile: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "access-egress-")));
  storeFile = path.join(tmp, "preview-egress.json");
  process.env.PI_PREVIEW_EGRESS_STORE = storeFile;
  resetPreviewEgressCache();
  app = Fastify({ logger: false });
  registerAccessRoutes(app, {
    networkGuard: async () => undefined,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    writeConfigPartial: () => ({ success: true }),
  });
  await app.ready();
});
afterEach(async () => {
  delete process.env.PI_PREVIEW_EGRESS_STORE;
  resetPreviewEgressCache();
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const list = async () => {
  const res = await app.inject({ method: "GET", url: "/api/access/grants" });
  expect(res.statusCode).toBe(200);
  return res.json().data.previewEgress as Array<{ store: string; project: string; origin: string }>;
};

/** The CSP a restricted token of a static target under `cwd` would be built with right now. */
function cspFor(cwd: string): string {
  const egress = createPreviewEgress({
    getStatic: () => ({ id: "st-1", cwd, root: cwd }),
    projectKeyOf: (c) => c,
    projectGrants: projectEgressGrants,
    allowOnce: () => [],
  });
  const grant = { targetId: "st-1", tokenId: "t", kind: "static", policy: { egress: "restricted", scripts: false }, minterKey: "local", principal: { kind: "local" } } as const;
  const built = buildLiveCsp({ policy: grant.policy, host: "dash:8000", scheme: "http", prefix: "/live/st-1/~c/T", granted: egress.grantedFor(grant) });
  return built?.csp ?? "";
}

describe("E28 — list and revoke", () => {
  it("lists a granted origin with its project; revoke removes it and the next CSP build drops it (no restart)", async () => {
    fs.writeFileSync(storeFile, JSON.stringify({ "/p": [CDN] }));
    expect(await list()).toEqual([{ store: "preview-egress", project: "/p", origin: CDN }]);
    expect(cspFor("/p")).toContain(CDN);

    const res = await app.inject({ method: "DELETE", url: "/api/access/preview-egress", payload: { project: "/p", origin: CDN } });
    expect(res.statusCode).toBe(200);
    expect(await list()).toEqual([]);
    expect(cspFor("/p")).not.toContain(CDN);
  });

  it("revokes one (project, origin) pair only", async () => {
    fs.writeFileSync(storeFile, JSON.stringify({ "/p": [CDN], "/q": [CDN, "https://unpkg.com"] }));
    await app.inject({ method: "DELETE", url: "/api/access/preview-egress", payload: { project: "/q", origin: CDN } });
    expect(await list()).toEqual([
      { store: "preview-egress", project: "/p", origin: CDN },
      { store: "preview-egress", project: "/q", origin: "https://unpkg.com" },
    ]);
    expect(cspFor("/p")).toContain(CDN);
    expect(cspFor("/q")).not.toContain(CDN);
  });

  it("an unknown grant is 404; a missing field is 400", async () => {
    fs.writeFileSync(storeFile, JSON.stringify({ "/p": [CDN] }));
    const gone = await app.inject({ method: "DELETE", url: "/api/access/preview-egress", payload: { project: "/zzz", origin: CDN } });
    expect(gone.statusCode).toBe(404);
    const bad = await app.inject({ method: "DELETE", url: "/api/access/preview-egress", payload: { project: "/p" } });
    expect(bad.statusCode).toBe(400);
    expect(await list()).toHaveLength(1);
  });
});

describe("E29 — missing or malformed store", () => {
  it("a missing file lists an empty group and is not created", async () => {
    expect(await list()).toEqual([]);
    expect(fs.existsSync(storeFile)).toBe(false);
  });

  it("malformed JSON lists an empty group, 200, and the file is not rewritten", async () => {
    fs.writeFileSync(storeFile, "{ definitely not json");
    expect(await list()).toEqual([]);
    expect(fs.readFileSync(storeFile, "utf8")).toBe("{ definitely not json");
  });
});
