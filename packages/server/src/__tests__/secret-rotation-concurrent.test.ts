/**
 * Two real processes starting on one HOME rotate exactly once.
 * See change: close-container-loopback-impersonation (D11; test-plan #X3).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { httpProofHeaders } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { createLocalCredentialVerifier, hasLocalCredential } from "../auth/local-credential.js";

const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../auth/secret-rotation.ts");
const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function runChild(home: string): Promise<{ code: number | null; out: string }> {
  const code = `import { rotateSecretsOnce } from ${JSON.stringify(MODULE)}; const r = await rotateSecretsOnce(); console.log(JSON.stringify(r));`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (c) => resolve({ code: c, out }));
  });
}

describe("concurrent first starts (X3)", () => {
  it("exactly one process rotates; both accept a proof minted from the final token", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "rotation-x3-"));
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
    const local = path.join(home, ".pi", "dashboard", "local");
    fs.mkdirSync(local, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(local, "token"), "T0-old", { mode: 0o600 });
    fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify({ auth: { secret: "S0" } }), { mode: 0o600 });

    const [a, b] = await Promise.all([runChild(home), runChild(home)]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);
    const rotated = [a, b].filter((r) => r.out.includes('"rotated":true'));
    expect(rotated, `${a.out}\n${b.out}`).toHaveLength(1);

    const final = fs.readFileSync(path.join(local, "token"), "utf-8").trim();
    expect(final).not.toBe("T0-old");
    // Final token is stable (a second rotation would have changed it again, and the epoch pins it).
    const [c] = await Promise.all([runChild(home)]);
    expect(c.out).toContain('"rotated":false');
    expect(fs.readFileSync(path.join(local, "token"), "utf-8").trim()).toBe(final);

    const verifier = createLocalCredentialVerifier({ token: final, acceptLegacyToken: false, log: () => {} });
    for (let i = 0; i < 2; i++) {
      const headers: Record<string, unknown> = Object.fromEntries(
        Object.entries(httpProofHeaders(final, "http://127.0.0.1:8000/api/x", "GET")).map(([k, v]) => [k.toLowerCase(), v]),
      );
      verifier.stamp({ headers, method: "GET", url: "/api/x", socket: { localAddress: "127.0.0.1", localPort: 8000 } }, { kind: "http", boundAt: 0, port: 8000 });
      expect(hasLocalCredential(headers)).toBe(true);
    }
  }, 60_000);
});
