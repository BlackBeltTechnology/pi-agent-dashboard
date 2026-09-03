/**
 * Whose machine did this session come from, and may we read its files?
 *
 * The dashboard already reaches into `session.sessionFile` on its own disk —
 * `existsSync` before a fork (`session-api.ts:348`), `statSync` for
 * `endedAt` (`derive-ended-at.ts:30`), `findSessionToolCallPayload` for the
 * full untruncated payloads the 4 KB in-memory cap loses. Every one of those
 * is correct for a LOCAL session and wrong for a remote one, because
 * `sessionFile` is a path on the ORIGIN host.
 *
 * The failure is not "file missing" — that would be harmless. Two machines with
 * the same username produce the SAME path (`/Users/robson/.pi/agent/...`), so
 * the server can open a real, readable, entirely unrelated file and serve it as
 * the remote session's transcript. That is #E15, and it is a correctness bug
 * before it is a security one.
 *
 * Origin is derived from the CREDENTIAL, never from a field the bridge sends:
 * a self-reported origin is a claim, and a claim from the party being
 * identified is not evidence.
 *
 * Tasks 11.7, 11.8, 11.12; test-plan #E15.
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it } from "vitest";
import { attributeOrigin, decideResume, mayReadLocalSessionFile } from "../session-origin.js";

const LOCAL_INSTANCE = "instance-abc";

describe("attributeOrigin", () => {
  it("attributes a socket/loopback bridge to this host", () => {
    const o = attributeOrigin({ transport: "unix", localInstanceId: LOCAL_INSTANCE });
    expect(o.local).toBe(true);
    expect(o.deviceId).toBeUndefined();
  });

  it("attributes an authenticated remote bridge to its paired device", () => {
    const o = attributeOrigin({
      transport: "tcp",
      remote: true,
      deviceId: "device-7",
      localInstanceId: LOCAL_INSTANCE,
    });
    expect(o.local).toBe(false);
    expect(o.deviceId).toBe("device-7");
  });

  it("ignores an origin the bridge claims for itself", () => {
    // A bridge asserting `originDeviceId` in its register payload must not be
    // able to launder a remote session into a local one — that would re-open
    // every filesystem path this gate closes.
    const o = attributeOrigin({
      transport: "tcp",
      remote: true,
      deviceId: "device-7",
      claimedDeviceId: "some-other-device",
      claimedLocal: true,
      localInstanceId: LOCAL_INSTANCE,
    } as never);
    expect(o.local).toBe(false);
    expect(o.deviceId).toBe("device-7");
  });

  it("treats a remote bridge with no device attribution as remote, not local", () => {
    // Fail closed: an unattributable connection is the one we know least about.
    const o = attributeOrigin({ transport: "tcp", remote: true, localInstanceId: LOCAL_INSTANCE });
    expect(o.local).toBe(false);
    expect(o.deviceId).toBeUndefined();
  });
});

describe("mayReadLocalSessionFile", () => {
  it("permits a local session, unchanged (task 11.12)", () => {
    const v = mayReadLocalSessionFile({
      origin: { local: true },
      sessionFile: "/Users/robson/.pi/agent/sessions/x.jsonl",
    });
    expect(v.allow).toBe(true);
  });

  it("refuses a remote session even when the path EXISTS locally (#E15)", () => {
    // The whole point: existence is not evidence of identity.
    const v = mayReadLocalSessionFile({
      origin: { local: false, deviceId: "device-7" },
      sessionFile: "/Users/robson/.pi/agent/sessions/x.jsonl",
    });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("remote-origin");
  });

  it("two hosts sharing a cwd and a sessionFile path stay distinct (#E15)", () => {
    const a = { local: true } as const;
    const b = { local: false, deviceId: "device-7" } as const;
    const sessionFile = "/Users/robson/Project/x/.pi/agent/sessions/s.jsonl";
    expect(mayReadLocalSessionFile({ origin: a, sessionFile }).allow).toBe(true);
    expect(mayReadLocalSessionFile({ origin: b, sessionFile }).allow).toBe(false);
  });

  it("refuses a local session with no recorded file rather than guessing one", () => {
    const v = mayReadLocalSessionFile({ origin: { local: true }, sessionFile: undefined });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("no-session-file");
  });

  it("names the cause, so a refusal is not reported as a missing file", () => {
    // "not found" would send an operator looking for a deleted transcript; the
    // real answer is that the transcript lives on another machine.
    const v = mayReadLocalSessionFile({
      origin: { local: false, deviceId: "device-7" },
      sessionFile: "/x.jsonl",
    });
    expect(v.allow === false && v.reason).toMatch(/device-7/);
  });
});

/**
 * D13 / task 11.11 — a remote session is read-only here, and an ENDED one
 * cannot be resumed at all.
 *
 * Resume spawns a local pi against `session.sessionFile`. For a remote session
 * that path is either absent (a confusing failure) or — worse — present and
 * unrelated, in which case resuming would start a pi WRITING to a stranger's
 * transcript. The #E15 collision with a write attached.
 *
 * test-plan #X19.
 */
describe("decideResume", () => {
  it("permits a local session, unchanged (task 11.12)", () => {
    expect(decideResume({ origin: { local: true }, status: "ended" }).allow).toBe(true);
    expect(decideResume({ origin: { local: true }, status: "active" }).allow).toBe(true);
  });

  it("refuses an ended remote session and explains that the host is unreachable", () => {
    const v = decideResume({ origin: { local: false, deviceId: "device-7" }, status: "ended" });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("remote-origin-ended");
    expect(v.allow === false && v.reason).toMatch(/device-7/);
  });

  it("refuses a LIVE remote session too — resuming it locally forks the writer", () => {
    // Not a subset of the ended case: a live remote session has a pi already
    // writing that file on its own host, so a local resume would be a second
    // writer, not a revival.
    const v = decideResume({ origin: { local: false, deviceId: "device-7" }, status: "active" });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.cause).toBe("remote-origin-live");
  });

  it("distinguishes the two remote causes, so the UI can say which is true", () => {
    const ended = decideResume({ origin: { local: false }, status: "ended" });
    const live = decideResume({ origin: { local: false }, status: "active" });
    expect(ended.allow === false && ended.cause).not.toBe(live.allow === false && live.cause);
  });
});
