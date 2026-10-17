/**
 * Operator consent: store (Always allow, revoke, corrupt file), dialog
 * semantics (Allow once / Always / Deny, Escape = Deny, 55 s auto-deny) and the
 * "Browser relay → Revoke all" menu item.
 * See change: add-operator-browser-relay (test-plan #E44–#E49 unit halves).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBrowserRelayMenuItem,
  CONSENT_DIALOG_TIMEOUT_MS,
  createConsentStore,
  type DialogOptions,
  requestConsent,
  setRevokeAllHook,
} from "../consent.js";
import { tempDir } from "./fixtures.js";

let tmp: ReturnType<typeof tempDir>;
beforeEach(() => {
  tmp = tempDir();
});
afterEach(() => {
  tmp.cleanup();
  vi.useRealTimers();
});
const store = (now = () => 1000) => createConsentStore({ dir: tmp.dir, log: () => {}, now });
const file = () => path.join(tmp.dir, "browser-host-consent.json");
const S1 = { origin: "http://192.168.16.204:8000", instanceId: "I1" };
const ALLOW_ONCE = 0;
const ALWAYS = 1;
const DENY = 2;

describe("consent store", () => {
  it("keys consent by (origin, instanceId, profile): a new instanceId asks again (E47)", () => {
    const s = store();
    s.grant(S1, "Default");
    expect(s.has(S1, "Default")).toBe(true);
    expect(s.has({ ...S1, instanceId: "I2" }, "Default")).toBe(false);
    expect(s.has({ ...S1, origin: "http://other:8000" }, "Default")).toBe(false);
    expect(s.has(S1, "Profile 1")).toBe(false);
  });

  it("persists across a restart and lists rows without secrets (E44)", () => {
    store().grant(S1, "Default");
    const rows = store().list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ serverOrigin: S1.origin, profileDirectory: "Default", grantedAt: 1000 });
    expect(typeof rows[0]!.key).toBe("string");
    expect(Object.keys(JSON.parse(fs.readFileSync(file(), "utf8")).consents)).toHaveLength(1);
  });

  it("writes the file owner-only on POSIX", () => {
    if (process.platform === "win32") return;
    store().grant(S1, "Default");
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
  });

  it("revoke(key) and revokeAll() drop consents (E48)", () => {
    const s = store();
    s.grant(S1, "Default");
    s.grant(S1, "Profile 1");
    expect(s.revoke(s.list()[0]!.key)).toBe(true);
    expect(s.list()).toHaveLength(1);
    expect(s.revoke("nope")).toBe(false);
    expect(s.revokeAll()).toBe(1);
    expect(store().list()).toEqual([]);
  });

  it("E49: an unreadable file is renamed browser-host-consent.corrupt-<ts>.json and treated as empty", () => {
    fs.writeFileSync(file(), "{not json");
    const s = store(() => 4242);
    expect(s.list()).toEqual([]);
    expect(fs.existsSync(path.join(tmp.dir, "browser-host-consent.corrupt-4242.json"))).toBe(true);
    expect(fs.existsSync(file())).toBe(false);
    expect(s.has(S1, "Default")).toBe(false);
  });

  it("sets aside an unsupported version too", () => {
    fs.writeFileSync(file(), JSON.stringify({ version: 99, consents: {} }));
    expect(store(() => 7).list()).toEqual([]);
    expect(fs.existsSync(path.join(tmp.dir, "browser-host-consent.corrupt-7.json"))).toBe(true);
  });
});

describe("requestConsent dialog", () => {
  const ask = (answer: (o: DialogOptions, signal: AbortSignal) => Promise<number>, s = store(), signal?: AbortSignal) =>
    requestConsent({
      store: s,
      dialog: { show: answer },
      serverKey: S1,
      serverLabel: "mac-home",
      profileDirectory: "Default",
      profileLabel: "Work",
      signal,
    });

  it("names server and profile; default and Escape are Deny", async () => {
    let seen: DialogOptions | undefined;
    await ask(async (o) => {
      seen = o;
      return DENY;
    });
    expect(seen!.buttons).toEqual(["Allow once", "Always allow", "Deny"]);
    expect(seen!.defaultId).toBe(DENY);
    expect(seen!.cancelId).toBe(DENY);
    expect(`${seen!.message} ${seen!.detail ?? ""}`).toContain("mac-home");
    expect(`${seen!.message} ${seen!.detail ?? ""}`).toContain("Work");
  });

  it("audit #1: the dialog names the VERIFIED target origin, never the server's own label as the identity", async () => {
    let seen: DialogOptions | undefined;
    await requestConsent({
      store: store(),
      dialog: { show: async (o) => ((seen = o), DENY) },
      serverKey: S1,
      serverLabel: "localhost:8000 (this computer)",
      profileDirectory: "Default",
      profileLabel: "Work",
    });
    expect(seen!.message).toContain(new URL(S1.origin).host);
    expect(seen!.message).not.toContain("this computer)");
  });

  it("Allow once → allow, nothing stored; Always allow → allow + stored (E44)", async () => {
    const s = store();
    expect(await ask(async () => ALLOW_ONCE, s)).toBe("allow");
    expect(s.list()).toHaveLength(0);
    expect(await ask(async () => ALWAYS, s)).toBe("allow");
    expect(s.has(S1, "Default")).toBe(true);
  });

  it("E45: Deny / Escape (cancelId) / a rejecting dialog → denied, nothing stored", async () => {
    const s = store();
    expect(await ask(async () => DENY, s)).toBe("denied");
    expect(await ask(async () => -1, s)).toBe("denied");
    expect(await ask(async () => { throw new Error("dialog failed"); }, s)).toBe("denied");
    expect(s.list()).toHaveLength(0);
  });

  it("sanitises control characters in the labels", async () => {
    let seen: DialogOptions | undefined;
    await requestConsent({
      store: store(),
      dialog: { show: async (o) => ((seen = o), DENY) },
      serverKey: S1,
      serverLabel: "evil\u0000\nlabel",
      profileDirectory: "Default",
      profileLabel: "p\u202eq",
    });
    expect(`${seen!.message}${seen!.detail}`).not.toMatch(/[\u0000\u202e]/);
  });

  it("E46: unanswered dialog auto-denies at exactly 55 000 ms and is closed", async () => {
    vi.useFakeTimers();
    let aborted = false;
    let result: string | undefined;
    const p = ask((_o, signal) => new Promise<number>((resolve) => signal.addEventListener("abort", () => ((aborted = true), resolve(DENY))))).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(CONSENT_DIALOG_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(CONSENT_DIALOG_TIMEOUT_MS).toBe(55_000);
    expect(result).toBe("denied");
    expect(aborted).toBe(true);
  });

  it("an external abort closes the dialog and resolves cancelled (no stored consent)", async () => {
    const ctl = new AbortController();
    const s = store();
    const p = ask((_o, signal) => new Promise<number>((resolve) => signal.addEventListener("abort", () => resolve(ALWAYS))), s, ctl.signal);
    ctl.abort();
    expect(await p).toBe("cancelled");
    expect(s.list()).toHaveLength(0);
  });

  it("an already-aborted signal never shows the dialog", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const show = vi.fn(async () => ALLOW_ONCE);
    expect(await requestConsent({ store: store(), dialog: { show }, serverKey: S1, serverLabel: "s", profileDirectory: "Default", profileLabel: "p", signal: ctl.signal })).toBe("cancelled");
    expect(show).not.toHaveBeenCalled();
  });
});

describe("Browser relay menu item (E48)", () => {
  it("has a 'Revoke all' child that calls the hook", () => {
    const revoke = vi.fn();
    setRevokeAllHook(revoke);
    const item = buildBrowserRelayMenuItem();
    expect(item.label).toBe("Browser relay");
    const sub = item.submenu as Array<{ label: string; click: () => void }>;
    expect(sub.map((i) => i.label)).toEqual(["Revoke all"]);
    sub[0]!.click();
    expect(revoke).toHaveBeenCalledTimes(1);
    setRevokeAllHook(null);
    expect(() => sub[0]!.click()).not.toThrow();
  });
});
