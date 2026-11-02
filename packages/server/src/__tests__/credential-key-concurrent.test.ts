/**
 * Two real server processes start together with no keychain entry and both
 * write a credential: they converge on ONE key (test-plan X6). Children run the
 * real credential-key module under tsx with the REAL worker entry against a
 * FAKE file-backed keychain (shared across processes); no real keychain.
 * See change: encrypt-credentials-at-rest (D4 creation lock; tasks 3.1, 14).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createKeyringSandbox, type KeyringSandbox } from "./helpers/credential-key-kit.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const CHILD = path.join(HERE, "helpers", "credential-key-child.mjs");
const require = createRequire(import.meta.url);

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

interface ChildResult { kid: string; created: boolean; decodedOther: string | null; locked: string | null; logs: string[] }

function runChild(env: Record<string, string>): Promise<ChildResult> {
  const tsx = pathToFileURL(require.resolve("tsx")).href;
  // Strip every vitest marker: the child must behave like a production server process.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VITEST|^VITE_/.test(k)));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsx, CHILD], { env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`child exited ${code}: ${err.slice(0, 500)}`));
      resolve(JSON.parse(out.trim().split("\n").pop() as string));
    });
  });
}

describe("concurrent key creation (real processes)", () => {
  it("X6: two processes with no keychain entry converge on one key and decode each other's files", async () => {
    const sandbox: KeyringSandbox = createKeyringSandbox();
    cleanup.push(() => sandbox.cleanup());
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-x6-home-"));
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
    const barrier = path.join(home, "go");
    const base = { HOME: home, USERPROFILE: home, CHILD_ROOT: SRC, CHILD_WORKER_ENTRY: sandbox.workerEntry, CHILD_BARRIER: barrier, ...sandbox.env };

    const a = runChild({ ...base, CHILD_ID: "A", CHILD_FILE_ID: "plugin-credentials", CHILD_OTHER_FILE_ID: "vault" });
    const b = runChild({ ...base, CHILD_ID: "B", CHILD_FILE_ID: "vault", CHILD_OTHER_FILE_ID: "plugin-credentials" });
    await new Promise((r) => setTimeout(r, 1500)); // both children booted and waiting on the barrier
    fs.writeFileSync(barrier, "");
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.kid).toMatch(/^[0-9a-f]{16}$/);
    expect(rb.kid).toBe(ra.kid);
    expect([ra.created, rb.created].filter(Boolean)).toHaveLength(1); // exactly one process created it
    const creations = [...ra.logs, ...rb.logs].filter((l) => l.includes("created source=keychain"));
    expect(creations).toHaveLength(1);
    expect(creations[0]).toContain(`kid=${ra.kid}`);
    expect(ra.decodedOther).toBe("B");
    expect(rb.decodedOther).toBe("A");
    expect(ra.locked).toBeNull();
    expect(rb.locked).toBeNull();
    expect(sandbox.log().filter((e) => e.op === "set")).toHaveLength(1); // the fake keychain `set` was effective once
    for (const l of [...ra.logs, ...rb.logs]) expect(l).not.toMatch(/[A-Za-z0-9+/]{43}=/);
  }, 60_000);
});
