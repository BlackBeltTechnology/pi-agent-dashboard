/**
 * Route-level tests for handle-verified byte serving (design D14, task 2.8).
 *
 * Covers test-plan X5 (9a.13), X14 (9a.24) and X16 (9a.29).
 *
 * The two refusal tests are built so that CONTAINMENT ADMITS the path: the FIFO
 * — and the symlink alias pointing at it — live INSIDE the granted subtree, and
 * `isGrantAdmitted` realpaths the request before comparing. A 403 can therefore
 * only come from the handle rule, never from containment, and that is asserted
 * explicitly (`expectContainmentAdmits`) rather than assumed. Without the
 * assertion these tests would pass for the wrong reason.
 *
 * `X14` is also a liveness test, not just a status code: `open(2)` on a FIFO
 * blocks a libuv worker until a writer appears, so before the fix the read site
 * never settles its promise and the test times out. That is the regression.
 *
 * See change: add-access-grants-and-review.
 */

import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants, grantedSubjects, recordGrant } from "../access/access-grants.js";
import { isAllowed, isGrantAdmitted } from "../lib/path-containment.js";
import { registerFileRoutes } from "../routes/file-routes.js";

/** `mkfifo` is POSIX-only; the Windows VM smoke layer does not run this suite. */
const posix = process.platform !== "win32";

let cwd: string;
let granted: string;
let savedStore: string | undefined;

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [{ cwd }] } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
  });
  return app;
}

const readUrl = (p: string): string =>
  `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}`;

/**
 * Assert the refusal below CANNOT be attributed to containment: layers ①/②
 * reject the path, and the grant layer admits it.
 */
async function expectContainmentAdmits(p: string): Promise<void> {
  expect(await isAllowed(p, { anchors: [cwd] })).toBe(false);
  expect(await isGrantAdmitted(p, grantedSubjects())).toBe(true);
}

describe("grant-admitted byte serving is verified against the open handle (task 2.8)", () => {
  beforeEach(async () => {
    cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "grv-cwd-"));
    granted = await fsp.mkdtemp(path.join(os.tmpdir(), "grv-out-"));
    savedStore = process.env.PI_ACCESS_GRANTS_STORE;
    process.env.PI_ACCESS_GRANTS_STORE = path.join(cwd, "grants.json");
    __resetAccessGrants();
    recordGrant({ subject: granted, scope: "project", origin: "test" });
  });

  afterEach(async () => {
    __resetAccessGrants();
    if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
    else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(granted, { recursive: true, force: true });
  });

  it("still serves a granted regular file — verification does not break the happy path", async () => {
    const file = path.join(granted, "ok.txt");
    await fsp.writeFile(file, "hello\n");
    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: readUrl(file) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ type: "file", content: "hello\n" });
    await app.close();
  });

  it.skipIf(!posix)("9a.24 refuses a granted FIFO before any open, without blocking", async () => {
    const fifo = path.join(granted, "pipe");
    execFileSync("mkfifo", [fifo]);
    await expectContainmentAdmits(fifo);

    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: readUrl(fifo) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      success: false,
      error: "path outside working directory",
    });
    await app.close();
  });

  it.skipIf(!posix)("9a.24 render refuses a granted FIFO instead of hanging on readFile", async () => {
    // `.adoc` because the render route rejects an unsupported extension with a
    // 400 BEFORE it ever consults containment — a bare FIFO name would never
    // reach the read this test is about.
    const fifo = path.join(granted, "pipe.adoc");
    execFileSync("mkfifo", [fifo]);
    await expectContainmentAdmits(fifo);

    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: `/api/file/render?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(fifo)}`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it.skipIf(!posix)("9a.13 refuses a granted path aliased to a non-regular file", async () => {
    const fifo = path.join(granted, "pipe");
    execFileSync("mkfifo", [fifo]);
    const alias = path.join(granted, "looks-like-a-file.txt");
    await fsp.symlink(fifo, alias);
    // realpath(alias) is the FIFO — still inside `granted`, so containment
    // admits. Only the handle rule refuses it.
    await expectContainmentAdmits(alias);

    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: readUrl(alias) });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("9a.29 still admits a granted directory at tree / exists / mention / directory read", async () => {
    await fsp.writeFile(path.join(granted, "inside.txt"), "hi\n");
    const app = makeApp();
    await app.ready();

    const tree = await app.inject({
      method: "GET",
      url: `/api/file/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(granted)}`,
    });
    expect(tree.statusCode).toBe(200);
    expect(
      tree.json().data.entries.map((e: { name: string }) => e.name),
    ).toContain("inside.txt");

    const exists = await app.inject({
      method: "GET",
      url: `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(granted)}`,
    });
    expect(exists.statusCode).toBe(200);
    expect(exists.json().data).toMatchObject({ exists: true });

    // The read site's directory branch — the regular-file rule must not break it.
    const dirRead = await app.inject({ method: "GET", url: readUrl(granted) });
    expect(dirRead.statusCode).toBe(200);
    expect(dirRead.json().data).toMatchObject({ type: "directory" });

    const mention = await app.inject({
      method: "POST",
      url: "/api/file/resolve-mention",
      payload: { cwd, mention: path.join(granted, "inside.txt") },
    });
    expect(mention.statusCode).toBe(200);
    expect(mention.json().data).toMatchObject({
      resolved: path.join(granted, "inside.txt"),
    });

    await app.close();
  });
});
