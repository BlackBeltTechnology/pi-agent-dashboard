/**
 * The askpass helper against a sudo-convention shim and failure modes (D1, D10).
 * The shim is pinned to the verified convention: no tty (setsid), `$SUDO_ASKPASS`
 * called without -A, prompt as argv[1], stdout = pipe, up to 3 same-ppid retries,
 * non-zero exit aborts without retry. See change: add-sudo-credential-prompt
 * (test-plan #S67, #S68).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SUDO_HELPER_FAILURE_MESSAGE, buildHelperSource } from "../sudo-askpass/helper-script.js";
import { createHarness, pollUntil, type Harness } from "./sudo-askpass-harness.js";

const harnesses: Harness[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) h.dispose();
  for (const c of cleanups.splice(0)) c();
});

const SHIM = `#!/bin/sh
# fake sudo: tries up to 3 times, same pid (retries), non-zero helper exit aborts.
tries=0
while [ "$tries" -lt 3 ]; do
  tries=$((tries + 1))
  pw=$("$SUDO_ASKPASS" "[sudo] password for u: ") || { echo "aborted" >> "$SHIM_LOG"; exit 1; }
  echo "got:$pw" >> "$SHIM_LOG"
  [ "$pw" = "$(cat "$SHIM_EXPECT_FILE")" ] && exit 0
done
exit 1
`;

function runShim(opts: { askpass: string; expect: string; log: string; shim: string }): Promise<number | null> {
  // The expectation travels in a file, never in the env the helper inherits.
  const expectFile = `${opts.log}.expect`;
  fs.writeFileSync(expectFile, opts.expect);
  return new Promise((resolve) => {
    // detached = setsid: no controlling tty, like pi's bash tool
    const child = spawn(opts.shim, [], {
      detached: true,
      stdio: "ignore",
      env: { PATH: process.env.PATH, SUDO_ASKPASS: opts.askpass, SHIM_EXPECT_FILE: expectFile, SHIM_LOG: opts.log },
    });
    child.on("close", (code) => resolve(code));
  });
}

async function setup(): Promise<{ h: Harness; shim: string; log: string; dir: string }> {
  const h = createHarness();
  harnesses.push(h);
  await h.install();
  h.startTool("A", "sudo true");
  const dir = fs.mkdtempSync(path.join(h.tmp, "shim-"));
  const shim = path.join(dir, "sudo");
  fs.writeFileSync(shim, SHIM, { mode: 0o755 });
  return { h, shim, log: path.join(dir, "log"), dir };
}

const lines = (log: string): string[] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);

describe("sudo convention pin (#S67)", () => {
  it("delivers the answer on stdout; sudo succeeds", async () => {
    const { h, shim, log } = await setup();
    const run = runShim({ askpass: h.ctl.wrapperPath() as string, expect: "P4ss", log, shim });
    await pollUntil(() => h.requests().length === 1);
    expect(h.requests()[0].prompt).toBe("[sudo] password for u: ");
    h.respond(h.requests()[0].callId, "P4ss");
    expect(await run).toBe(0);
    expect(lines(log)).toEqual(["got:P4ss"]);
  });

  it("a wrong password triggers exactly 2 more invocations, then sudo stops", async () => {
    const { h, shim, log } = await setup();
    const run = runShim({ askpass: h.ctl.wrapperPath() as string, expect: "right", log, shim });
    for (let n = 1; n <= 3; n++) {
      await pollUntil(() => h.requests().length === n, `request ${n}`);
      h.respond(h.requests()[n - 1].callId, "wrong");
    }
    expect(await run).toBe(1);
    expect(h.requests()).toHaveLength(3);
    expect(lines(log)).toEqual(["got:wrong", "got:wrong", "got:wrong"]);
  });

  it("helper exit 1 (Cancel) means sudo gets zero retries", async () => {
    const { h, shim, log } = await setup();
    const run = runShim({ askpass: h.ctl.wrapperPath() as string, expect: "x", log, shim });
    await pollUntil(() => h.requests().length === 1);
    h.cancel(h.requests()[0].callId);
    expect(await run).toBe(1);
    expect(h.requests()).toHaveLength(1);
    expect(lines(log)).toEqual(["aborted"]);
  });

  it("the helper's argv and env never contain the password", async () => {
    const { h, shim, log, dir } = await setup();
    const rec = path.join(dir, "rec.sh");
    const out = path.join(dir, "rec.out");
    fs.writeFileSync(rec, `#!/bin/sh\nenv > "${out}"\nprintf '%s\\n' "$@" >> "${out}"\nexec "$@"\n`, { mode: 0o755 });
    const instrumented = path.join(dir, "askpass-rec");
    const original = fs.readFileSync(h.ctl.wrapperPath() as string, "utf8");
    fs.writeFileSync(instrumented, original.replace(`exec '${process.execPath}'`, `exec '${rec}' '${process.execPath}'`), { mode: 0o700 });

    const run = runShim({ askpass: instrumented, expect: "Canary-Secret-9", log, shim });
    await pollUntil(() => h.requests().length === 1);
    h.respond(h.requests()[0].callId, "Canary-Secret-9");
    expect(await run).toBe(0);
    const recorded = fs.readFileSync(out, "utf8");
    expect(recorded).toContain("h.cjs"); // the instrumented hop saw the helper's own argv
    expect(recorded).not.toContain("Canary-Secret-9");
  });
});

describe("helper failure modes (#S68)", () => {
  function runHelper(socketPath: string): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-fail-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "h.cjs");
    fs.writeFileSync(file, buildHelperSource(socketPath));
    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(process.execPath, [file, "a prompt with SECRET-LOOKING text"], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - t0 }));
    });
  }

  const expectFixedFailure = (r: { code: number | null; stdout: string; stderr: string; ms: number }): void => {
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(SUDO_HELPER_FAILURE_MESSAGE);
    expect(r.stderr).not.toContain("SECRET-LOOKING");
    expect(r.ms).toBeLessThan(5000); // no hang
  };

  it("(a) bridge gone (ECONNREFUSED / no socket): exit 1, one fixed message", async () => {
    expectFixedFailure(await runHelper(path.join(os.tmpdir(), `no-such-${process.pid}.sock`)));
  });

  const withServer = async (onConn: (s: net.Socket) => void): Promise<string> => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hs-"));
    const sock = path.join(dir, "s");
    const server = net.createServer(onConn).listen(sock);
    await new Promise<void>((r) => server.once("listening", () => r()));
    cleanups.push(() => {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return sock;
  };

  it("(b) socket closes mid-prompt", async () => {
    const sock = await withServer((s) => s.on("data", () => s.destroy()));
    expectFixedFailure(await runHelper(sock));
  });

  it("(c) garbage bytes from the bridge", async () => {
    const sock = await withServer((s) => s.on("data", () => s.end("\x00\x01 not the protocol \xff")));
    expectFixedFailure(await runHelper(sock));
  });
});
