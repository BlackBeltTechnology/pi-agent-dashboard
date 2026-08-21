/**
 * The rendezvous record is the selector (D0/D2), and an unusable one resolves
 * to "no local dashboard" rather than to anything the network offered.
 *
 * (test-plan #E9, #E11 — the bridge-side half)
 * See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGatewaySocketPath } from "../dashboard-paths.js";
import {
  getRendezvousRecordPath,
  readRendezvousRecord,
  rendezvousEndpoint,
} from "../rendezvous.js";

let home: string;
const env = () => ({ homedir: home });

const RECORD = {
  pid: 111,
  ppid: 1,
  httpPort: 8000,
  piPort: 9999,
  startedAt: 1,
  identity: "instance-abc",
  version: "1.0.0",
  url: "http://localhost:8000",
  hostname: "h",
};

const write = (body: string) => {
  const p = getRendezvousRecordPath(env());
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rdv-"));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("readRendezvousRecord", () => {
  it("reads a well-formed record", () => {
    write(JSON.stringify(RECORD));
    expect(readRendezvousRecord(env())).toEqual({
      piPort: 9999,
      httpPort: 8000,
      pid: 111,
      instanceId: "instance-abc",
    });
  });

  it("returns null when absent — no local dashboard", () => {
    expect(readRendezvousRecord(env())).toBeNull();
    expect(rendezvousEndpoint(env())).toBeNull();
  });

  // (test-plan #E11) Truncated mid-JSON: absent, never partially trusted.
  it("returns null for a record truncated mid-JSON", () => {
    const full = JSON.stringify(RECORD);
    write(full.slice(0, full.length - 12));
    expect(readRendezvousRecord(env())).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    write(JSON.stringify({ ...RECORD, identity: undefined }));
    expect(readRendezvousRecord(env())).toBeNull();
  });
});

describe("rendezvousEndpoint", () => {
  it("resolves the per-instance socket for the recorded piPort on POSIX", () => {
    if (process.platform === "win32") return;
    write(JSON.stringify(RECORD));
    const res = rendezvousEndpoint(env());
    expect(res?.instanceId).toBe("instance-abc");
    expect(res?.endpoint).toBe(`ws+unix://${getGatewaySocketPath(env(), 9999)}:/`);
  });

  it("carries the identity to verify, so a foreign listener can be refused", () => {
    write(JSON.stringify({ ...RECORD, identity: "someone-else" }));
    expect(rendezvousEndpoint(env())?.instanceId).toBe("someone-else");
  });


  // (task 3.8) The endpoint alone cannot be verified: the caller needs the
  // port where the instance publishes its id.
  it("carries the http port so the instance can be verified", () => {
    write(JSON.stringify(RECORD));
    expect(rendezvousEndpoint(env())?.httpPort).toBe(RECORD.httpPort);
  });
});

/**
 * #1.2 — local endpoint resolution is a pure function of the injected HOME.
 *
 * The four properties are asserted together because each alone is satisfiable
 * by a broken implementation: stability alone is satisfied by a constant,
 * per-HOME distinctness alone by a random value, and both by a cache keyed on
 * the wrong thing. The last property is the one this change exists for — the
 * resolver reads the record, and reads NOTHING else.
 */
describe("local endpoint resolution derives from the injected homedir (task 1.2)", () => {
  it("is stable across calls for one HOME", () => {
    write(JSON.stringify(RECORD));
    const a = rendezvousEndpoint(env());
    const b = rendezvousEndpoint(env());
    expect(a?.endpoint).toBe(b?.endpoint);
    expect(a?.endpoint).toBe(
      `ws+unix://${getGatewaySocketPath(env(), RECORD.piPort)}:/`,
    );
  });

  it("differs for two distinct HOMEs holding an identical record", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rdv-b-"));
    try {
      write(JSON.stringify(RECORD));
      const otherPath = getRendezvousRecordPath({ homedir: other });
      fs.mkdirSync(path.dirname(otherPath), { recursive: true });
      fs.writeFileSync(otherPath, JSON.stringify(RECORD));

      const mine = rendezvousEndpoint(env());
      const theirs = rendezvousEndpoint({ homedir: other });
      // Same piPort, same identity, same everything — only HOME differs.
      expect(mine?.endpoint).not.toBe(theirs?.endpoint);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("never consults discovery: no record means no endpoint, not a lookup", () => {
    // A hostile mDNS responder is irrelevant here because there is nothing to
    // ask — resolution is filesystem-only by construction.
    expect(rendezvousEndpoint(env())).toBeNull();
  });

  it("ignores os.homedir() when a homedir is injected", () => {
    write(JSON.stringify(RECORD));
    const resolved = rendezvousEndpoint(env());
    expect(resolved?.endpoint).toContain(home);
    expect(resolved?.endpoint).not.toContain(os.homedir());
  });
});
