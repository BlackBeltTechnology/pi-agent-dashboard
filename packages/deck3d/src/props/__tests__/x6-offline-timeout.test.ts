/**
 * X6 — a stalling online source must not stall `props search`: the request is
 * aborted at `DECK3D_HTTP_TIMEOUT_MS`, vendored rows are printed, one notice
 * line is written to stderr, and the command exits 0 quickly.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";
import { searchProps } from "../search.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const STALL_MS = 5000;
const TIMEOUT_MS = 200;

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CliRun> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(BIN, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (status) => resolve({ status, stdout, stderr, ms: Date.now() - start }));
  });
}

let server: MockServer;
beforeAll(async () => {
  server = await startMockServer({ body: JSON.stringify({ results: [] }), contentType: "application/json", delayMs: STALL_MS });
});
afterAll(async () => {
  await server.close();
});

function env(): NodeJS.ProcessEnv {
  return { ...process.env, POLY_PIZZA_KEY: "k", POLY_PIZZA_ENDPOINT: `${server.url}/search`, DECK3D_HTTP_TIMEOUT_MS: String(TIMEOUT_MS) };
}

describe("X6 offline search (timeout)", () => {
  it("searchProps aborts inside the timeout and keeps the vendored rows", async () => {
    const start = Date.now();
    const result = await searchProps("robot", { key: "k", endpoint: `${server.url}/search`, timeoutMs: TIMEOUT_MS });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.notices).toEqual(["online source skipped (timeout)"]);
    expect(result.candidates.some((c) => c.source === "vendored" && c.id === "robot")).toBe(true);
  });

  it("props search exits 0 within 1 s, prints vendored rows and one timeout notice", async () => {
    const start = Date.now();
    const r = await runCli(["props", "search", "robot"], join(process.cwd()), env());
    const elapsed = Date.now() - start;
    expect(r.status, r.stderr).toBe(0);
    expect(elapsed).toBeLessThan(3000);
    expect(r.stdout).toContain("vendored\trobot");
    expect(r.stderr.trim().split("\n")).toEqual(["online source skipped (timeout)"]);
  });
});
