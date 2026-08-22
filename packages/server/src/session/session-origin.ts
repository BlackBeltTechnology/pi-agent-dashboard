/**
 * Which machine a session came from, and whether its files are ours to read.
 *
 * `session.sessionFile` is a path on the ORIGIN host. For a local session that
 * is the same host and every existing filesystem read is correct. For a remote
 * one it is a path on someone else's disk — and the dangerous case is not a
 * missing file but a PRESENT one: two machines with the same username produce
 * identical paths, so the server can open a real, unrelated transcript and
 * serve it as the remote session's own (#E15).
 *
 * Attribution comes from the CREDENTIAL the connection authenticated with, not
 * from anything the bridge says about itself. A self-reported origin is a claim
 * by the party being identified, and accepting it would let a remote bridge
 * launder itself local and re-open every path this gate closes.
 *
 * See change: add-pi-gateway-transport-identity (D12/D13; tasks 11.7, 11.8).
 */

export interface SessionOrigin {
  /** True when the session's files live on THIS host. */
  local: boolean;
  /** Paired-device id for a remote session, when the connection was attributable. */
  deviceId?: string;
}

export interface OriginEvidence {
  transport: "unix" | "tcp";
  /** True when the peer is not loopback. */
  remote?: boolean;
  /** Paired-device id resolved from the bridge's ticket/bearer. */
  deviceId?: string;
  localInstanceId: string;
}

/**
 * Derive origin from connection evidence. Extra fields a bridge may have sent
 * (`claimedDeviceId`, `claimedLocal`, …) are deliberately not read.
 */
export function attributeOrigin(evidence: OriginEvidence): SessionOrigin {
  // A unix socket is same-host by construction: the peer opened a file in this
  // HOME's 0700 directory. Loopback TCP is same-host too.
  if (evidence.transport === "unix" || !evidence.remote) return { local: true };
  // Remote, attributable or not. Unattributable stays remote — fail closed.
  return evidence.deviceId ? { local: false, deviceId: evidence.deviceId } : { local: false };
}

type LocalReadRefusal = "remote-origin" | "no-session-file";

export type LocalReadVerdict =
  | { allow: true; sessionFile: string }
  | { allow: false; cause: LocalReadRefusal; reason: string };

/** May the server read this session's `.jsonl` from its OWN filesystem? */
export function mayReadLocalSessionFile(input: {
  origin: SessionOrigin;
  sessionFile: string | undefined;
}): LocalReadVerdict {
  if (!input.origin.local) {
    return {
      allow: false,
      cause: "remote-origin",
      reason:
        `session originated on ${input.origin.deviceId ?? "an unattributed remote device"}; ` +
        "its transcript is not on this filesystem",
    };
  }
  if (!input.sessionFile) {
    return {
      allow: false,
      cause: "no-session-file",
      reason: "session has no recorded transcript path",
    };
  }
  return { allow: true, sessionFile: input.sessionFile };
}

type ResumeRefusal = "remote-origin-ended" | "remote-origin-live";

export type ResumeVerdict =
  | { allow: true }
  | { allow: false; cause: ResumeRefusal; reason: string };

/**
 * May this server resume the session by spawning a local pi?
 *
 * Only for a session that originated here. A remote one is read-only (D13):
 * its transcript is not on this filesystem, and the same-username path
 * collision of #E15 means a local resume could attach a WRITER to an unrelated
 * host's transcript. The two remote causes are distinct because they are
 * different facts to present — "that machine is gone" versus "that machine is
 * still running it".
 */
export function decideResume(input: {
  origin: SessionOrigin;
  status: string;
}): ResumeVerdict {
  if (input.origin.local) return { allow: true };
  const who = input.origin.deviceId ?? "an unattributed remote device";
  return input.status === "ended"
    ? {
        allow: false,
        cause: "remote-origin-ended",
        reason: `session ran on ${who}, which is no longer connected; its transcript is readable here but cannot be resumed`,
      }
    : {
        allow: false,
        cause: "remote-origin-live",
        reason: `session is still running on ${who}; resuming it here would start a second pi writing the same transcript`,
      };
}
