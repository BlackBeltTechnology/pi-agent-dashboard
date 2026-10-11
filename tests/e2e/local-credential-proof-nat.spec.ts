/**
 * NAT'd / published-port callers are not admitted by a local credential proof
 * (test-plan X9, change: loopback-credential-proof, task 8.3).
 *
 * The specs run on the HOST and reach the container through a PUBLISHED port, so
 * the server's own arriving local address is the container's, not the
 * `127.0.0.1:<hostPort>` the host's proof names. A proof bound to the published
 * address is therefore `binding-mismatch`: it earns no credential. The same
 * request made INSIDE the container (genuine loopback, proof bound to
 * `127.0.0.1:<containerPort>`) succeeds.
 *
 * This is the documented BREAKING edge of the change for `pi-dashboard login
 * --local` / `open` / `token create` run against a published port.
 */
import { execFileSync } from "node:child_process";
import { canonicalBinding, httpPurpose, mintProof } from "../../packages/shared/src/local-credential-proof.ts";
import { expect, test } from "./fixtures.js";
import { DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

const CODE_PATH = "/api/identity/local-code";

function containerId(): string {
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
    encoding: "utf8",
    timeout: 30_000,
  })
    .trim()
    .split("\n")[0];
  if (!id) throw new Error("harness container not running");
  return id;
}

const dockerExec = (id: string, args: string[]) =>
  execFileSync("docker", ["exec", id, ...args], { encoding: "utf8", timeout: 60_000 });

test.describe("local credential proof through a published port (X9)", () => {
  test("host → published port is refused with binding-mismatch; inside the container it succeeds", async () => {
    const id = containerId();
    const token = dockerExec(id, ["cat", "/home/pi/.pi/dashboard/local/token"]).trim();
    expect(token).not.toBe("");

    // 1. Minted on the HOST for the address it dials (the published port).
    const hostPort = DASHBOARD_PORT;
    const proof = mintProof({
      token,
      binding: canonicalBinding("127.0.0.1", hostPort),
      purpose: httpPurpose("POST", CODE_PATH),
    }).header;
    const res = await fetch(`http://127.0.0.1:${hostPort}${CODE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pi-local-proof": proof },
      body: "{}",
    });
    expect(res.status).toBe(401);

    // The sub-cause is in the SERVER log only, never in the response.
    const log = dockerExec(id, ["sh", "-c", "cat /home/pi/.pi/dashboard/server.log 2>/dev/null || true"]);
    expect(log).toContain("binding-mismatch");
    expect(await res.text()).not.toContain("binding-mismatch");

    // 2. The same request INSIDE the container: the server's arriving address is
    //    the one the proof names.
    const inside = dockerExec(id, [
      "node",
      "-e",
      `
      const crypto = require("node:crypto");
      const token = require("node:fs").readFileSync("/home/pi/.pi/dashboard/local/token","utf8").trim();
      const port = ${hostPort}; // the compose file publishes the same port number on both sides
      const key = crypto.createHmac("sha256", Buffer.from(token)).update("pi-dashboard/local-credential-proof/v1").digest();
      const ts = String(Date.now()), nonce = crypto.randomBytes(16).toString("base64url");
      const mac = crypto.createHmac("sha256", key).update("pi-lcp/v1/client\\n127.0.0.1:" + port + "\\n" + ts + "\\n" + nonce + "\\nhttp POST ${CODE_PATH}").digest("base64url");
      fetch("http://127.0.0.1:" + port + "${CODE_PATH}", { method: "POST", headers: { "content-type": "application/json", "x-pi-local-proof": "v1." + ts + "." + nonce + "." + mac }, body: "{}" })
        .then((r) => process.stdout.write(String(r.status))).catch((e) => process.stdout.write("ERR " + e.message));
    `,
    ]);
    expect(inside.trim()).toBe("200");
  });
});
