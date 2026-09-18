/**
 * X7 — `props search` degrades to the vendored corpus with a one-line notice
 * and exit 0 both when the online endpoint refuses connections and when no
 * `POLY_PIZZA_KEY` is configured.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type MockServer, startMockServer } from "../../__tests__/helpers/mock-http.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** A port that was bound and released: connecting yields ECONNREFUSED. */
async function refusedUrl(): Promise<string> {
  const server: MockServer = await startMockServer({ body: "" });
  const url = server.url;
  await server.close();
  return `${url}/search`;
}

describe("X7 offline search (abort / unconfigured)", () => {
  it("falls back to vendored rows with an unreachable notice on ECONNREFUSED", async () => {
    const r = await runCli(["props", "search", "robot"], join(process.cwd()), {
      ...process.env,
      POLY_PIZZA_KEY: "k",
      POLY_PIZZA_ENDPOINT: await refusedUrl(),
      DECK3D_HTTP_TIMEOUT_MS: "2000",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("vendored\trobot");
    expect(r.stderr).toContain("online source skipped (unreachable)");
  });

  it("falls back to vendored rows with a no-key notice when unconfigured", async () => {
    const r = await runCli(["props", "search", "robot"], join(process.cwd()), {
      ...process.env,
      POLY_PIZZA_KEY: "",
      POLY_PIZZA_ENDPOINT: "http://127.0.0.1:9/search",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("vendored\trobot");
    expect(r.stderr).toContain("online source skipped (no POLY_PIZZA_KEY)");
  });
});
