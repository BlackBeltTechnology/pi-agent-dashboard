/**
 * Default-session permission policy (ELEC-01). See change: close-local-listener-and-egress-gaps (D3).
 */
import { describe, expect, it, vi } from "vitest";
import { ALLOWED_PERMISSIONS, installDefaultSessionPermissions, isPermissionAllowed } from "../permissions.js";

type Req = (wc: unknown, perm: string, cb: (g: boolean) => void, details: Record<string, unknown>) => void;
type Chk = (wc: unknown, perm: string, origin: string, details: Record<string, unknown>) => boolean;

const ORIGIN = "http://localhost:8000";
const ALLOWED = ["clipboard-sanitized-write", "notifications", "fullscreen"];
// Electron 44 union (electron.d.ts:13930) minus the three allowed.
const DENIED = [
  "ar", "automatic-fullscreen", "background-fetch", "background-sync", "captured-surface-control", "clipboard-read",
  "deprecated-sync-clipboard-read", "display-capture", "fileSystem", "geolocation", "geolocation-approximate",
  "hand-tracking", "hid", "idle-detection", "keyboardLock", "local-fonts", "local-network", "local-network-access",
  "loopback-network", "media", "mediaKeySystem", "midi", "midiSysex", "nfc", "openExternal", "payment-handler",
  "periodic-background-sync", "persistent-storage", "pointerLock", "screen-wake-lock", "sensors", "serial",
  "smart-card", "speaker-selection", "storage-access", "system-wake-lock", "top-level-storage-access", "usb", "vr",
  "web-app-installation", "web-printing", "window-management",
];

function setup(getOrigin: () => string | undefined) {
  let request!: Req;
  let check!: Chk;
  const warn = vi.fn();
  installDefaultSessionPermissions(
    {
      setPermissionRequestHandler: (h) => {
        request = h as unknown as Req;
      },
      setPermissionCheckHandler: (h) => {
        check = h as unknown as Chk;
      },
    },
    getOrigin,
    warn,
  );
  const ask = (perm: string, url: string | undefined, isMainFrame = true) => {
    const cb = vi.fn();
    request({}, perm, cb, { isMainFrame, requestingUrl: url });
    return cb.mock.calls[0][0] as boolean;
  };
  const chk = (perm: string, url: string | undefined, isMainFrame = true, requestingOrigin = url ?? "") =>
    check({}, perm, requestingOrigin, { isMainFrame, requestingUrl: url });
  return { ask, chk, check, warn };
}

describe("permissions", () => {
  it("allowlist is exactly the three permissions; openExternal is not in it", () => {
    expect([...ALLOWED_PERMISSIONS].sort()).toEqual([...ALLOWED].sort());
    expect(isPermissionAllowed("openExternal")).toBe(false);
    for (const p of ALLOWED) expect(isPermissionAllowed(p)).toBe(true);
  });

  it("E71: three permissions granted to the main frame at the allowed origin, request and check", () => {
    const s = setup(() => ORIGIN);
    for (const p of ALLOWED) {
      expect(s.ask(p, `${ORIGIN}/x`)).toBe(true);
      expect(s.chk(p, `${ORIGIN}/x`)).toBe(true);
    }
    expect(s.warn).not.toHaveBeenCalled();
  });

  it("E72: everything else denied (both handlers)", () => {
    const s = setup(() => ORIGIN);
    for (const p of DENIED) {
      expect(s.ask(p, `${ORIGIN}/`), p).toBe(false);
      expect(s.chk(p, `${ORIGIN}/`), p).toBe(false);
    }
  });

  it("E73: subframe denied", () => {
    const s = setup(() => ORIGIN);
    expect(s.ask("notifications", `${ORIGIN}/`, false)).toBe(false);
    expect(s.chk("notifications", `${ORIGIN}/`, false)).toBe(false);
  });

  it("E74: foreign / lookalike origins denied; case-normalised origin granted", () => {
    const s = setup(() => ORIGIN);
    for (const u of [
      "http://localhost:8001/",
      "https://localhost:8000/",
      "http://localhost:8000@evil.com/",
      "http://evil.com/",
      "http://sub.localhost:8000/",
    ]) {
      expect(s.ask("notifications", u), u).toBe(false);
      expect(s.chk("notifications", u), u).toBe(false);
    }
    expect(s.ask("notifications", "HTTP://LOCALHOST:8000/x")).toBe(true);
    expect(s.chk("notifications", "HTTP://LOCALHOST:8000/x")).toBe(true);
  });

  it("E75: no allowed origin never matches an unparsable/missing requesting URL", () => {
    const s = setup(() => undefined);
    for (const u of [undefined, "", "not a url"]) {
      expect(s.ask("notifications", u)).toBe(false);
      expect(s.chk("notifications", u, true, "")).toBe(false);
    }
    expect(s.ask("notifications", `${ORIGIN}/`)).toBe(false);
    expect(s.chk("notifications", undefined, false, ORIGIN)).toBe(false);
  });

  it("E76: document-less check (service worker, wc null) — notifications at the allowed origin only", () => {
    const s = setup(() => ORIGIN);
    const run = (perm: string, origin: string) => s.check(null, perm, origin, { isMainFrame: false });
    expect(run("notifications", ORIGIN)).toBe(true);
    expect(run("notifications", "http://evil.com")).toBe(false);
    for (const p of ["media", "clipboard-sanitized-write", "fullscreen"]) {
      expect(run(p, ORIGIN), p).toBe(false);
      expect(run(p, "http://evil.com"), p).toBe(false);
    }
  });

  it("E77: no window / destroyed / empty URL → getAllowedOrigin undefined → denied", () => {
    const s = setup(() => undefined);
    for (const p of ALLOWED) {
      expect(s.ask(p, `${ORIGIN}/`)).toBe(false);
      expect(s.chk(p, `${ORIGIN}/`)).toBe(false);
    }
  });

  it("E79: file:// bundled pages denied for all three permissions", () => {
    const s = setup(() => ORIGIN);
    for (const u of ["file:///app/doctor.html", "file:///app/remote-connect.html", "file:///app/loading.html", "about:blank", "data:text/html,x"]) {
      for (const p of ALLOWED) {
        expect(s.ask(p, u), `${u} ${p}`).toBe(false);
        expect(s.chk(p, u), `${u} ${p}`).toBe(false);
      }
    }
  });

  it("E79b: a file:// allowed origin (\"null\") never grants a file:// page", () => {
    const s = setup(() => "null");
    expect(s.ask("notifications", "file:///app/doctor.html")).toBe(false);
  });

  it("the grant follows getAllowedOrigin() on every call (navigation)", () => {
    let current: string | undefined = "http://localhost:8000";
    const s = setup(() => current);
    expect(s.ask("notifications", "http://localhost:8000/")).toBe(true);
    current = "http://127.0.0.1:8000";
    expect(s.ask("notifications", "http://127.0.0.1:8000/")).toBe(true);
    expect(s.ask("notifications", "http://localhost:8000/")).toBe(false);
    current = undefined;
    expect(s.ask("notifications", "http://127.0.0.1:8000/")).toBe(false);
  });

  it("E81: denial warns once per (permission, origin); grants never warn", () => {
    const s = setup(() => ORIGIN);
    for (let i = 0; i < 3; i++) s.ask("media", "http://evil.com/");
    expect(s.warn).toHaveBeenCalledTimes(1);
    s.ask("media", "http://other.com/");
    expect(s.warn).toHaveBeenCalledTimes(2);
    s.ask("geolocation", "http://other.com/");
    expect(s.warn).toHaveBeenCalledTimes(3);
    s.warn.mockClear();
    for (let i = 0; i < 5; i++) s.ask("notifications", `${ORIGIN}/`);
    expect(s.warn).not.toHaveBeenCalled();
  });

  it("X40: a throwing getAllowedOrigin denies and does not throw out of either handler", () => {
    const s = setup(() => {
      throw new Error("Object has been destroyed");
    });
    expect(() => s.ask("notifications", `${ORIGIN}/`)).not.toThrow();
    expect(s.ask("notifications", `${ORIGIN}/`)).toBe(false);
    expect(s.chk("notifications", `${ORIGIN}/`)).toBe(false);
    expect(s.check(null, "notifications", ORIGIN, { isMainFrame: false })).toBe(false);
  });
});
