/**
 * The recovery server's `/api/recovery/reinstall` route must OWN a rejected
 * reinstall: without the `.catch`, the request hangs until the browser times
 * out and the operator sees nothing. Here `spawn` throws synchronously inside
 * `runReinstall`'s promise executor, so the promise rejects and the route must
 * answer HTTP 500.
 *
 * Focused file (keeps the `node:child_process` mock out of the main
 * recovery-server suite). Bind idiom mirrors `recovery-server.test.ts`.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      throw new Error("spawn boom");
    }),
  };
});

import { startRecoveryServer } from "../lifecycle/recovery-server.js";

function postText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("recovery server — reinstall rejection is owned", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("X11 a rejected reinstall answers HTTP 500 and is logged, not floated", async () => {
    const port = await startRecoveryServer({
      port: 0,
      error: new Error("Cannot find module 'fastify'"),
      missingModule: "fastify",
    });

    const res = await postText(`http://127.0.0.1:${port}/api/recovery/reinstall`);
    expect(res.status).toBe(500);
    expect(res.body).toContain("Reinstall failed:");
    // Rejection observed by the route handler, not floated.
    expect(
      errorSpy.mock.calls.some((c: unknown[]) => typeof c[0] === "string" && c[0].includes("[recovery-install] reinstall threw")),
    ).toBe(true);
    expect(unhandled).toEqual([]);
  });
});
