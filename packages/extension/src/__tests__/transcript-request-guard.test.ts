/**
 * The bridge side of D12: what a dashboard is allowed to ask a bridge for.
 *
 * A remote dashboard is not trusted with the bridge's filesystem. It knows one
 * thing — a sessionId — and that is deliberately the ONLY addressing mode:
 * the moment a request can name a path, the bridge becomes a file-read oracle
 * for whatever the pi process can read, which on a developer machine is
 * everything. Note that the existing `/api/session-file` route confines paths
 * to the session cwd; that confinement is a *server-local* check and does not
 * travel, which is exactly why the wire format carries no path at all.
 *
 * Two refusals, and they are different failures:
 *   - a path on the wire  → the request shape itself is illegitimate (#E14)
 *   - a foreign sessionId → the shape is fine, the subject is not (#E13)
 *
 * Tasks 11.3, 11.4; test-plan #E13, #E14.
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it, vi } from "vitest";
import { decideTranscriptRequest } from "../transcript-request-guard.js";

const OWN = "session-owned-by-this-bridge";

describe("decideTranscriptRequest", () => {
  it("serves a request naming this bridge's own session", () => {
    const v = decideTranscriptRequest({ request: { sessionId: OWN }, ownSessionId: OWN });
    expect(v.allow).toBe(true);
  });

  it("refuses a request naming any other session (#E13)", () => {
    const v = decideTranscriptRequest({
      request: { sessionId: "some-other-session" },
      ownSessionId: OWN,
    });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("foreign-session");
  });

  it("refuses a path field even when the sessionId is correct (#E14)", () => {
    const v = decideTranscriptRequest({
      request: { sessionId: OWN, path: "../../etc/passwd" } as never,
      ownSessionId: OWN,
    });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("path-on-the-wire");
  });

  it.each([
    ["path", "../../etc/passwd"],
    ["file", "/etc/shadow"],
    ["sessionFile", "~/.ssh/id_ed25519"],
    ["filePath", "C:\\Windows\\System32\\config\\SAM"],
    // A benign-looking relative name is refused on the same rule: the check is
    // on the FIELD's presence, not on whether the value looks like an escape.
    // Validating the value would make the guard a traversal-parsing contest.
    ["path", "notes.md"],
  ])("refuses a request carrying %s", (field, value) => {
    const v = decideTranscriptRequest({
      request: { sessionId: OWN, [field]: value } as never,
      ownSessionId: OWN,
    });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("path-on-the-wire");
  });

  it("refuses the path BEFORE deciding on the session, so a probe learns nothing", () => {
    // If the foreign-session check ran first, a caller could distinguish
    // "session exists here" from "session does not" by whether a path-bearing
    // request came back as foreign-session or as path-on-the-wire.
    const v = decideTranscriptRequest({
      request: { sessionId: "some-other-session", path: "x" } as never,
      ownSessionId: OWN,
    });
    expect(v.allow === false && v.cause).toBe("path-on-the-wire");
  });

  it("cannot touch the filesystem at all (#E14)", async () => {
    // Asserted statically rather than with a spy: `vi.spyOn` cannot redefine an
    // ESM namespace export, and a spy would only prove this ONE call path is
    // clean. The guard importing no filesystem module proves it for every path,
    // including ones added later.
    const fsMod = await import("node:fs");
    const src = fsMod.readFileSync(
      new URL("../transcript-request-guard.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/from "node:fs/);
    expect(src).not.toMatch(/require\(["']fs/);
    expect(src).not.toMatch(/from "node:child_process/);
  });

  it("refuses everything while this bridge has no session id yet", () => {
    // Before `session_register` settles there is no subject to compare against,
    // and treating "unknown" as "matches" would serve the first asker.
    const v = decideTranscriptRequest({
      request: { sessionId: OWN },
      ownSessionId: undefined,
    });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("foreign-session");
  });
});
