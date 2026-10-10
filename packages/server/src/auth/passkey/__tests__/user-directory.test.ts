/**
 * User directory: users, tiers, status, invites, credentials, orphan impact.
 * See change: add-passkey-user-auth (passkey-user-auth › User directory,
 * › Invite by QR, › Relying-party ID; tasks 4B.1, 3.5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserDirectory } from "../user-directory.js";

let dir: string;
let file: string;
let clock: number;
const now = () => clock;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-users-"));
  file = path.join(dir, "users.json");
  clock = 1_000_000;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const cred = (id: string, rpId: string) => ({ id, publicKey: "pk", counter: 0, rpId });

describe("UserDirectory", () => {
  it("creates an invited user with a tier and persists 0600", async () => {
    const d = new UserDirectory(file, now);
    expect(d.isEmpty()).toBe(true);
    const anna = await d.create({ name: "Anna", tier: "observe" });
    expect(anna).toMatchObject({ name: "Anna", tier: "observe", status: "invited", credentials: [] });
    expect(anna.id).toMatch(/^[0-9a-f]{32}$/);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // reload from disk
    const d2 = new UserDirectory(file, now);
    expect(d2.get(anna.id)?.name).toBe("Anna");
  });

  it("rejects a bad name or tier", async () => {
    const d = new UserDirectory(file, now);
    await expect(d.create({ name: "", tier: "observe" })).rejects.toThrow(/name/);
    await expect(d.create({ name: "x".repeat(65), tier: "observe" })).rejects.toThrow(/name/);
    await expect(d.create({ name: "ok", tier: "root" as any })).rejects.toThrow(/tier/);
  });

  it("strips control characters from names", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "An\u0000na\n", tier: "observe" });
    expect(u.name).toBe("Anna");
  });

  it("invite: single-use by default, 24h expiry, token never stored in clear", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "Anna", tier: "observe" });
    const { token, invite } = await d.mintInvite(u.id);
    expect(invite).toMatchObject({ maxUses: 1, uses: 0, expiresAt: clock + 24 * 3600_000 });
    expect(fs.readFileSync(file, "utf8")).not.toContain(token);
    expect(d.resolveInvite(token)).toMatchObject({ ok: true, user: { id: u.id } });

    const after = await d.enrollWithInvite(token, cred("c1", "host.ts.net"));
    expect(after).toMatchObject({ ok: true });
    const anna = d.get(u.id)!;
    expect(anna.status).toBe("active");
    expect(anna.credentials).toHaveLength(1);
    expect(anna.credentials[0]).toMatchObject({ id: "c1", rpId: "host.ts.net" });

    expect(d.resolveInvite(token)).toEqual({ ok: false, error: "exhausted" });
    expect(await d.enrollWithInvite(token, cred("c2", "host.ts.net"))).toEqual({ ok: false, error: "exhausted" });
    expect(d.get(u.id)!.credentials).toHaveLength(1);
  });

  it("expired invite is rejected", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "Anna", tier: "observe" });
    const { token } = await d.mintInvite(u.id, { ttlMs: 1000 });
    clock += 1001;
    expect(d.resolveInvite(token)).toEqual({ ok: false, error: "expired" });
    expect(await d.enrollWithInvite(token, cred("c1", "h"))).toEqual({ ok: false, error: "expired" });
  });

  it("unknown / revoked invites are invalid", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "Anna", tier: "observe" });
    const { token, invite } = await d.mintInvite(u.id);
    expect(d.resolveInvite("nope")).toEqual({ ok: false, error: "invalid" });
    await d.revokeInvite(invite.id);
    expect(d.resolveInvite(token)).toEqual({ ok: false, error: "invalid" });
  });

  it("revoking a user kills sessions and invites", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "Anna", tier: "control" });
    const { token } = await d.mintInvite(u.id);
    await d.enrollWithInvite(token, cred("c1", "h"));
    expect(d.sessionTier(u.id)).toBe("control");
    const { token: t2 } = await d.mintInvite(u.id);
    await d.revoke(u.id);
    expect(d.sessionTier(u.id)).toBeNull();
    expect(d.resolveInvite(t2)).toEqual({ ok: false, error: "invalid" });
    expect(d.findCredential("c1")).toBeNull();
  });

  it("re-tier applies to sessionTier immediately", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "Anna", tier: "observe" });
    await d.enrollWithInvite((await d.mintInvite(u.id)).token, cred("c1", "h"));
    await d.setTier(u.id, "operate");
    expect(d.sessionTier(u.id)).toBe("operate");
  });

  it("invited (not yet enrolled) user has no session tier", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "Anna", tier: "observe" });
    expect(d.sessionTier(u.id)).toBeNull();
    expect(d.sessionTier("unknown")).toBeNull();
  });

  it("credentials are filtered by RP ID; switching back revives them (3.5)", async () => {
    const d = new UserDirectory(file, now);
    const a = await d.create({ name: "A", tier: "observe" });
    const b = await d.create({ name: "B", tier: "observe" });
    await d.enrollWithInvite((await d.mintInvite(a.id, { maxUses: 2 })).token, cred("a1", "old.ts.net"));
    const inv = await d.mintInvite(a.id, { maxUses: 2 });
    await d.enrollWithInvite(inv.token, cred("a2", "old.ts.net"));
    await d.enrollWithInvite((await d.mintInvite(b.id)).token, cred("b1", "old.ts.net"));
    await d.enrollWithInvite((await d.mintInvite(b.id)).token, cred("b2", "other.zrok.io"));

    expect(d.findCredential("a1", "old.ts.net")?.credential.id).toBe("a1");
    expect(d.findCredential("a1", "new.ts.net")).toBeNull();
    expect(d.findCredential("b2", "other.zrok.io")?.credential.id).toBe("b2");

    expect(d.impact("old.ts.net", "new.ts.net")).toEqual({ orphaned: 3, users: 2 });
    expect(d.impact("old.ts.net", "old.ts.net")).toEqual({ orphaned: 0, users: 0 });
    // switch back: credentials still present, usable again
    expect(d.findCredential("a2", "old.ts.net")?.user.id).toBe(a.id);
  });

  it("first user is forced to operate by bootstrap()", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.bootstrap({ name: "Root" });
    expect(u.tier).toBe("operate");
    await expect(d.bootstrap({ name: "Again" })).rejects.toThrow(/not empty/);
  });

  it("touchCredential updates counter and lastUsedAt", async () => {
    const d = new UserDirectory(file, now);
    const u = await d.create({ name: "A", tier: "observe" });
    await d.enrollWithInvite((await d.mintInvite(u.id)).token, cred("c1", "h"));
    clock += 5;
    await d.touchCredential(u.id, "c1", 7);
    expect(d.get(u.id)!.credentials[0]).toMatchObject({ counter: 7, lastUsedAt: clock });
  });

  it("concurrent mutations do not lose writes", async () => {
    const d = new UserDirectory(file, now);
    await Promise.all(Array.from({ length: 5 }, (_, i) => d.create({ name: `U${i}`, tier: "observe" })));
    expect(new UserDirectory(file, now).list()).toHaveLength(5);
  });

  it("a corrupt file loads empty without throwing", () => {
    fs.writeFileSync(file, "{not json", { mode: 0o600 });
    expect(new UserDirectory(file, now).isEmpty()).toBe(true);
  });
});
