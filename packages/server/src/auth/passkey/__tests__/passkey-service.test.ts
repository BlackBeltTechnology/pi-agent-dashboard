/**
 * Passkey ceremonies against the real `@simplewebauthn/server` verifier.
 * See change: add-passkey-user-auth (passkey-user-auth › Invite by QR enrolls a
 * passkey, › Passkey login, › Relying-party ID, › Passkeys gated on a stable
 * origin; tasks 4B.2, 3.5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PasskeyError, PasskeyService } from "../passkey-service.js";
import type { RpContext } from "../rp-context.js";
import { UserDirectory } from "../user-directory.js";
import { createCredential, getAssertion } from "./soft-authenticator.js";

const ORIGIN = "https://host.tailnet.ts.net";
const stable: RpContext = { rpOrigin: ORIGIN, rpId: "host.tailnet.ts.net", stable: true };

let dir: string;
let rp: RpContext;
let logs: string[];
let directory: UserDirectory;
let svc: PasskeyService;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-passkey-"));
  rp = stable;
  logs = [];
  directory = new UserDirectory(path.join(dir, "users.json"));
  svc = new PasskeyService({ directory, getRpContext: () => rp, log: (l) => logs.push(l) });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function enroll(name = "Anna", tier: "observe" | "control" | "operate" = "observe") {
  const user = await directory.create({ name, tier });
  const { token } = await directory.mintInvite(user.id);
  const { challengeId, options } = await svc.registrationOptions(token);
  const { response, credential } = createCredential(options, ORIGIN);
  const enrolled = await svc.verifyRegistration(challengeId, response);
  return { user: enrolled, credential, token };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof PasskeyError ? `${e.status}:${e.code}` : `other:${(e as Error).message}`;
  }
  return "resolved";
};

describe("invite enrollment", () => {
  it("phone enrolls from a valid invite: active, one credential bound to the RP ID", async () => {
    const { user } = await enroll();
    expect(user.status).toBe("active");
    expect(user.credentials).toHaveLength(1);
    expect(user.credentials[0]!.rpId).toBe("host.tailnet.ts.net");
    expect(logs).toContain(`[passkey] enrolled id=${user.id.slice(0, 8)}`);
  });

  it("registration options require user verification and a resident key", async () => {
    const u = await directory.create({ name: "A", tier: "observe" });
    const { options } = await svc.registrationOptions((await directory.mintInvite(u.id)).token);
    expect(options.rp.id).toBe("host.tailnet.ts.net");
    expect(options.authenticatorSelection).toMatchObject({ userVerification: "required", residentKey: "required" });
  });

  it("exhausted invite is refused and adds no credential", async () => {
    const { user, token } = await enroll();
    expect(await code(svc.registrationOptions(token))).toBe("410:invite_exhausted");
    expect(directory.get(user.id)!.credentials).toHaveLength(1);
  });

  it("an exhausted invite cannot complete even with options fetched earlier", async () => {
    const u = await directory.create({ name: "A", tier: "observe" });
    const { token } = await directory.mintInvite(u.id);
    const a = await svc.registrationOptions(token);
    const b = await svc.registrationOptions(token);
    await svc.verifyRegistration(a.challengeId, createCredential(a.options, ORIGIN).response);
    expect(await code(svc.verifyRegistration(b.challengeId, createCredential(b.options, ORIGIN).response))).toBe("410:invite_exhausted");
    expect(directory.get(u.id)!.credentials).toHaveLength(1);
  });

  it("expired invite is refused", async () => {
    const u = await directory.create({ name: "A", tier: "observe" });
    const { token } = await directory.mintInvite(u.id, { ttlMs: 1000 });
    const later = new PasskeyService({ directory: new UserDirectory(path.join(dir, "users.json"), () => Date.now() + 5000), getRpContext: () => rp, log: () => {} });
    expect(await code(later.registrationOptions(token))).toBe("410:invite_expired");
  });

  it("registration without user verification is refused", async () => {
    const u = await directory.create({ name: "A", tier: "observe" });
    const { challengeId, options } = await svc.registrationOptions((await directory.mintInvite(u.id)).token);
    const { response } = createCredential(options, ORIGIN, { uv: false });
    expect(await code(svc.verifyRegistration(challengeId, response))).toBe("401:verification_failed");
    expect(directory.get(u.id)!.status).toBe("invited");
  });

  it("registration from a foreign origin is refused", async () => {
    const u = await directory.create({ name: "A", tier: "observe" });
    const { challengeId, options } = await svc.registrationOptions((await directory.mintInvite(u.id)).token);
    const { response } = createCredential(options, "https://evil.example");
    expect(await code(svc.verifyRegistration(challengeId, response))).toBe("401:verification_failed");
  });
});

describe("passkey login", () => {
  it("successful assertion returns the active user", async () => {
    const { user, credential } = await enroll("Anna", "observe");
    const { challengeId, options } = await svc.authenticationOptions();
    expect(options.userVerification).toBe("required");
    const out = await svc.verifyAuthentication(challengeId, getAssertion(credential, options, ORIGIN));
    expect(out).toMatchObject({ id: user.id, tier: "observe" });
    expect(logs).toContain(`[passkey] login id=${user.id.slice(0, 8)}`);
  });

  it("replayed assertion for the same challenge is refused", async () => {
    const { credential } = await enroll();
    const { challengeId, options } = await svc.authenticationOptions();
    const assertion = getAssertion(credential, options, ORIGIN);
    await svc.verifyAuthentication(challengeId, assertion);
    expect(await code(svc.verifyAuthentication(challengeId, assertion))).toBe("400:challenge_invalid");
  });

  it("assertion without user verification is refused", async () => {
    const { credential } = await enroll();
    const { challengeId, options } = await svc.authenticationOptions();
    expect(await code(svc.verifyAuthentication(challengeId, getAssertion(credential, options, ORIGIN, { uv: false })))).toBe("401:verification_failed");
  });

  it("revoked user cannot log in", async () => {
    const { user, credential } = await enroll();
    await directory.revoke(user.id);
    const { challengeId, options } = await svc.authenticationOptions();
    expect(await code(svc.verifyAuthentication(challengeId, getAssertion(credential, options, ORIGIN)))).toBe("401:unknown_credential");
  });

  it("orphaned credential (other RP ID) is not accepted; switching back revives it", async () => {
    const { credential } = await enroll();
    rp = { rpOrigin: "https://other.example.com", rpId: "other.example.com", stable: true };
    const a = await svc.authenticationOptions();
    expect(await code(svc.verifyAuthentication(a.challengeId, getAssertion(credential, { ...a.options, rpId: "host.tailnet.ts.net" }, "https://other.example.com")))).toBe("401:orphaned_credential");
    expect(logs.some((l) => l.startsWith("[passkey] orphaned id="))).toBe(true);
    rp = stable;
    const b = await svc.authenticationOptions();
    await expect(svc.verifyAuthentication(b.challengeId, getAssertion(credential, b.options, ORIGIN))).resolves.toBeTruthy();
  });
});

describe("stable-origin gate", () => {
  it("every ceremony entry point refuses 409 unstable_origin", async () => {
    const u = await directory.create({ name: "A", tier: "observe" });
    const { token } = await directory.mintInvite(u.id);
    rp = { rpOrigin: "https://abc.share.zrok.io", rpId: "abc.share.zrok.io", stable: false, reason: "ephemeral_tunnel" };
    expect(await code(svc.registrationOptions(token))).toBe("409:unstable_origin");
    expect(await code(svc.authenticationOptions())).toBe("409:unstable_origin");
    expect(() => svc.requireStable()).toThrow(PasskeyError);
  });
});
