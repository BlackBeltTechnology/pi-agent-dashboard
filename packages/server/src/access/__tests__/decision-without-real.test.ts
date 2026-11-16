/**
 * An admitting decision that lacks `real` is a refusal at every gate: the gates never fall back to the
 * lexical `resolved` to open (test-plan #E27).
 *
 * `evaluateContainment` is stubbed to admit with `real: undefined`; the three gates are the real ones
 * (`gateFilePath` directly and through `/api/file/eml`, `gateReadPath` through `/api/file`, `gateOfficeFile`
 * through `/api/file/sheet`). "No open performed" is observed on `fs.open`, not inferred from the status.
 *
 * See change: close-local-listener-and-egress-gaps (D2).
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateFilePath, registerFileRoutes } from "../../routes/file-routes.js";

const h = vi.hoisted(() => ({ evaluate: vi.fn() }));

vi.mock("../containment-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../containment-gate.js")>()),
  evaluateContainment: (...a: unknown[]) => h.evaluate(...a),
}));

const MARKER = "NO-REAL-MARKER-5d02";
let base: string;
let cwd: string;
let app: FastifyInstance;

beforeEach(async () => {
  base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "no-real-")));
  cwd = path.join(base, "cwd");
  await fsp.mkdir(cwd);
  for (const f of ["a.txt", "a.csv", "a.eml"]) await fsp.writeFile(path.join(cwd, f), MARKER);
  h.evaluate.mockReset();
  h.evaluate.mockImplementation(async (resolved: string) => ({ allowed: true, viaGrant: false, resolved, real: undefined }));
  app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [{ cwd }] } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
  });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await fsp.rm(base, { recursive: true, force: true });
});

describe("a decision without `real` is refused, never opened on the lexical path", () => {
  it.each([
    ["gateReadPath (/api/file)", "/api/file", "a.txt"],
    ["gateOfficeFile (/api/file/sheet)", "/api/file/sheet", "a.csv"],
    ["gateFilePath (/api/file/eml)", "/api/file/eml", "a.eml"],
  ])("%s answers 403, no open, no bytes", async (_name, route, file) => {
    const open = vi.spyOn(fsp, "open");
    const res = await app.inject({ method: "GET", url: `${route}?cwd=${encodeURIComponent(cwd)}&path=${file}` });
    expect(h.evaluate, "the stubbed decision was reached").toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "path outside working directory" });
    expect(res.body).not.toContain(MARKER);
    expect(open.mock.calls.filter(([p]) => String(p).startsWith(cwd))).toEqual([]);
  });

  it("gateFilePath returns a {code:403} refusal, not a {resolved} success", async () => {
    const gate = await gateFilePath(cwd, "a.txt", { knownCwds: () => [cwd] }, {});
    expect(h.evaluate).toHaveBeenCalled();
    expect(gate).toMatchObject({ code: 403, error: "path outside working directory" });
    expect(gate).not.toHaveProperty("resolved");
  });
});
