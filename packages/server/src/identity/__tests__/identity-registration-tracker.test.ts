import { describe, expect, it, vi } from "vitest";
import { IdentityRegistrationTracker } from "../identity-registration-tracker.js";

describe("IdentityRegistrationTracker — failed activation releases identity registrations (D21)", () => {
  it("disposes every registration of a plugin that did not load, and keeps loaded ones", () => {
    const t = new IdentityRegistrationTracker();
    const failedDesc = vi.fn();
    const failedRes = vi.fn();
    const okRes = vi.fn();
    t.track("login-plane", failedDesc);
    t.track("login-plane", failedRes);
    t.track("keycloak-resolver", okRes);
    const released = t.releaseUnloaded((id) => id === "keycloak-resolver");
    expect(released).toEqual(["login-plane"]);
    expect(failedDesc).toHaveBeenCalledOnce();
    expect(failedRes).toHaveBeenCalledOnce();
    expect(okRes).not.toHaveBeenCalled();
  });

  it("track returns the original disposer so callers keep their unregister handle", () => {
    const t = new IdentityRegistrationTracker();
    const d = vi.fn();
    const h = t.track("p", d);
    h();
    expect(d).toHaveBeenCalledOnce();
  });

  it("is idempotent — a second release does not re-dispose", () => {
    const t = new IdentityRegistrationTracker();
    const d = vi.fn();
    t.track("p", d);
    t.releaseUnloaded(() => false);
    expect(t.releaseUnloaded(() => false)).toEqual([]);
    expect(d).toHaveBeenCalledOnce();
  });
});

describe("IdentityRegistrationTracker — frozen after arming (D21 latch)", () => {
  it("turns every handle into a no-op once frozen, reporting the ignored call", () => {
    const ignored: string[] = [];
    const t = new IdentityRegistrationTracker((id) => ignored.push(id));
    const d = vi.fn();
    const h = t.track("login-plane", d);
    t.freeze();
    h();
    expect(d).not.toHaveBeenCalled();
    expect(ignored).toEqual(["login-plane"]);
  });

  it("handles still work before freezing", () => {
    const t = new IdentityRegistrationTracker();
    const d = vi.fn();
    const h = t.track("p", d);
    h();
    expect(d).toHaveBeenCalledOnce();
  });

  it("exposes frozen so late registrations can be refused", () => {
    const t = new IdentityRegistrationTracker();
    expect(t.frozen).toBe(false);
    t.freeze();
    expect(t.frozen).toBe(true);
  });
});
