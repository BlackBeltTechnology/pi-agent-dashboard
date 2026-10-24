/**
 * E2E: harden-peer-address-identity — test-plan #X6.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 fakes the network. Only two REAL dashboards on one multicast network, each owning an
 * interface with the SAME address (`bridge0` = 192.168.64.1/24, the macOS Virtualization
 * default present on every Mac), show the whole chain: neither server advertises the shared
 * address, each sees the other as a non-local peer, and an operator who adds the shared address
 * gets `409 self_address` (the address reaches the operator's OWN dashboard) with the list
 * untouched.
 *
 * Needs the opt-in two-dashboard overlay:
 *   PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.peer.yml docker/test-up.sh -d --build
 * Without it the spec skips. The peer container is not published; this spec reaches it with
 * `docker exec`. Exemplar: known-server-stale-name.spec.ts (operator context).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { DASHBOARD_PORT, harnessProject, REPO_ROOT } from "./lifecycle.js";

const SHARED_BRIDGE_IP = "192.168.64.1";
const OVERLAY = "compose.test.peer.yml";

/** The overlay was asked for (env of a managed run, or the state file `test-up.sh` wrote). */
function peerOverlayRequested(): boolean {
  if ((process.env.TEST_EXTRA_COMPOSE ?? "").includes(OVERLAY)) return true;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8")) as { extraCompose?: string[] };
    return (state.extraCompose ?? []).includes(OVERLAY);
  } catch {
    return false;
  }
}

/** A dashboard's fingerprint as its public identity challenge proves it (SHA-256 of the SPKI key). */
function fingerprintOfKey(publicKeyB64: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(publicKeyB64, "base64url")).digest("base64url")}`;
}

/** The mDNS instance label a dashboard advertises: `pi-dashboard-<first 12 hex of sha256(fp)>-<port>`. */
function advertLabel(fingerprint: string): string {
  return `pi-dashboard-${createHash("sha256").update(fingerprint, "utf8").digest("hex").slice(0, 12)}-${DASHBOARD_PORT}`;
}

/** The fingerprint of the dashboard in `containerId`, asked over its own loopback (the peer is not published). */
function containerFingerprint(containerId: string): string {
  const script = `fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/pair/challenge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({nonce:"peer-bridge-spec-nonce-0001"})}).then(r=>r.json()).then(j=>console.log(j.data.publicKey))`;
  return fingerprintOfKey(execFileSync("docker", ["exec", containerId, "node", "-e", script], { encoding: "utf8", timeout: 30_000 }).trim());
}

function serviceContainer(service: string): string | undefined {
  try {
    const id = execFileSync(
      "docker",
      ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`, "--filter", `label=com.docker.compose.service=${service}`],
      { encoding: "utf8", timeout: 30_000 },
    )
      .trim()
      .split("\n")[0];
    return id || undefined;
  } catch {
    return undefined;
  }
}

/** Every `_pi-dashboard._tcp` advert the container sees on the network, with the addresses it lists. */
function browseAdverts(containerId: string): Array<{ fqdn: string; addresses: string[] }> {
  const script = `
    const { Bonjour } = require("bonjour-service");
    const b = new Bonjour();
    const found = new Map();
    const collect = (s) => found.set(s.fqdn, { fqdn: s.fqdn, addresses: s.addresses || [] });
    const br = b.find({ type: "pi-dashboard" });
    br.on("up", collect); br.on("srv-update", collect); br.on("txt-update", collect);
    setTimeout(() => br.update(), 1000);
    setTimeout(() => { console.log(JSON.stringify([...found.values()])); b.destroy(); process.exit(0); }, 6000);
  `;
  const out = execFileSync("docker", ["exec", "-w", "/app", containerId, "node", "-e", script], { encoding: "utf8", timeout: 60_000 });
  return JSON.parse(out.trim().split("\n").pop() ?? "[]");
}

test("two dashboards sharing a bridge address: nobody advertises it, peers stay non-local, adding it is self_address", async ({ request }) => {
  test.skip(!peerOverlayRequested(), `needs TEST_EXTRA_COMPOSE=${OVERLAY} (two dashboards sharing a bridge address)`);
  test.setTimeout(240_000);
  // Requested but a container is missing is a FAILURE (the overlay did not come up), never a skip.
  const a = serviceContainer("pi-dashboard");
  const b = serviceContainer("pi-dashboard-peer");
  expect(a, "pi-dashboard container").toBeTruthy();
  expect(b, "pi-dashboard-peer container").toBeTruthy();
  const headers = operatorHeaders();
  const fpA = containerFingerprint(a!);
  const fpB = containerFingerprint(b!);
  expect(fpA).not.toBe(fpB); // two machines, two identities

  // 1) A discovers exactly B (by fingerprint) as a peer that is not local — and never itself.
  let peers: Array<{ fingerprint?: string; isLocal: boolean; host: string }> = [];
  await expect
    .poll(
      async () => {
        const res = await request.post("/api/discover-servers", { headers });
        peers = ((await res.json()).data ?? []) as typeof peers;
        return peers.some((p) => p.fingerprint === fpB);
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBe(true);
  expect(peers.find((p) => p.fingerprint === fpB)?.isLocal).toBe(false);
  expect(peers.some((p) => p.fingerprint === fpA)).toBe(false); // A never lists itself

  // 2) Both dashboards advertise, and neither advert lists the shared address (both hold it on `bridge0`).
  for (const id of [a!, b!]) {
    const adverts = browseAdverts(id);
    const labels = adverts.map((advert) => advert.fqdn);
    expect(labels.some((l) => l.startsWith(advertLabel(fpA))), `A's advert seen from ${id}`).toBe(true);
    expect(labels.some((l) => l.startsWith(advertLabel(fpB))), `B's advert seen from ${id}`).toBe(true);
    for (const advert of adverts) expect(advert.addresses, advert.fqdn).not.toContain(SHARED_BRIDGE_IP);
  }

  // 3) The operator adds the shared address: it reaches A's OWN dashboard.
  const before = await (await request.get("/api/known-servers", { headers })).json();
  const added = await request.post("/api/known-servers", { data: { host: SHARED_BRIDGE_IP, port: DASHBOARD_PORT, label: "Shared bridge" }, headers });
  expect(added.status()).toBe(409);
  expect((await added.json()).error).toBe("self_address");
  const after = await (await request.get("/api/known-servers", { headers })).json();
  expect(after.data).toEqual(before.data);
});
