/**
 * Bundled connecting.html DOM behaviour (jsdom).
 * See change: add-electron-server-windows (test-plan F1, F2).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "renderer", "connecting.html"), "utf8");

interface Harness {
  dom: JSDOM;
  push: (s: Record<string, unknown>) => void;
  api: Record<string, ReturnType<typeof vi.fn>>;
  text: (id: string) => string;
  visible: (id: string) => boolean;
}

/** jsdom runs the page in its own realm, so its `Date` is replaced with a controllable clock. */
const clock = { now: Date.now() };

function load(initial: Record<string, unknown> | null = null): Harness {
  let listener: ((s: unknown) => void) | undefined;
  const api = {
    ready: vi.fn(async () => initial),
    onState: vi.fn((cb: (s: unknown) => void) => {
      listener = cb;
      return () => {};
    }),
    sendRequest: vi.fn(async () => {}),
    stopWaiting: vi.fn(async () => {}),
    pairAgain: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window: JSDOM["window"]) {
      (window as unknown as { connecting: unknown }).connecting = api;
      const RealDate = window.Date;
      (window as unknown as { Date: unknown }).Date = class extends RealDate {
        static now(): number {
          return clock.now;
        }
      };
    },
  });
  const doc = dom.window.document;
  return {
    dom,
    api,
    push: (s) => listener?.(s),
    text: (id) => doc.getElementById(id)?.textContent ?? "",
    visible: (id) => !doc.getElementById(id)?.classList.contains("hidden"),
  };
}

const base = { label: "home-imac", host: "192.168.16.204:8000", unencrypted: true, deviceName: "my-mac", shortFp: "sha256:AAAAAAAAAAAAAAAA" };

afterEach(() => {
  clock.now = Date.now();
});

describe("waiting view (F1)", () => {
  it("shows 4821 7730, a countdown that ticks, the unencrypted notice and Stop waiting", () => {
    clock.now = 1_000_000;
    const h = load();
    h.push({ ...base, phase: "waiting", confirmCode: "48217730", expiresAt: 1_000_000 + 300_000 });
    expect(h.text("code")).toBe("4821 7730");
    expect(h.text("countdown")).toContain("5:00");
    clock.now = 1_001_000;
    h.dom.window.dispatchEvent(new h.dom.window.Event("focus"));
    expect(h.text("countdown")).toContain("4:59");
    expect(h.visible("unencrypted")).toBe(true);
    expect(h.visible("btn-stop")).toBe(true);
    expect(h.visible("btn-send")).toBe(false);
  });

  it("an https target shows no unencrypted notice", () => {
    const h = load();
    h.push({ ...base, unencrypted: false, phase: "waiting", confirmCode: "48217730", expiresAt: clock.now + 1000 });
    expect(h.visible("unencrypted")).toBe(false);
  });

  it("Stop waiting calls the bridge", () => {
    const h = load();
    h.push({ ...base, phase: "waiting", confirmCode: "48217730", expiresAt: clock.now + 10_000 });
    h.dom.window.document.getElementById("btn-stop")!.click();
    expect(h.api.stopWaiting).toHaveBeenCalled();
  });
});

describe("TOFU confirm view (F2)", () => {
  it("full fingerprint + compare prompt, Send request enabled, no code", () => {
    const h = load();
    const full = `sha256:${"C".repeat(43)}`;
    h.push({ ...base, phase: "confirm", tofu: true, fullFp: full });
    expect(h.visible("tofu")).toBe(true);
    expect(h.text("full-fp")).toBe(full);
    expect(h.text("tofu")).toMatch(/compare this fingerprint/i);
    const send = h.dom.window.document.getElementById("btn-send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(h.visible("btn-send")).toBe(true);
    expect(h.visible("view-waiting")).toBe(false);
    expect(h.text("code")).toBe("");
  });

  it("device name is prefilled and editable; the request carries the field value", () => {
    const h = load();
    h.push({ ...base, phase: "confirm", tofu: false });
    const input = h.dom.window.document.getElementById("device-name") as HTMLInputElement;
    expect(input.value).toBe("my-mac");
    input.value = "";
    input.dispatchEvent(new h.dom.window.Event("input"));
    h.push({ ...base, phase: "confirm", tofu: false }); // a re-push must not clobber the user's edit
    expect(input.value).toBe("");
    h.dom.window.document.getElementById("btn-send")!.click();
    expect(h.api.sendRequest).toHaveBeenCalledWith("");
  });

  it("a non-TOFU confirm hides the fingerprint block", () => {
    const h = load();
    h.push({ ...base, phase: "confirm", tofu: false });
    expect(h.visible("tofu")).toBe(false);
  });
});

describe("terminal phases", () => {
  it("untrusted label is rendered as text, never markup", () => {
    const h = load();
    h.push({ ...base, label: "<img src=x onerror=alert(1)>", phase: "proving" });
    expect(h.dom.window.document.querySelector("img")).toBeNull();
    expect(h.text("title")).toContain("<img");
  });

  it("refusal with noRetry offers no retry; others do; mismatch offers none", () => {
    const h = load();
    h.push({ ...base, phase: "refused", message: "Requests are only accepted from the same local network.", noRetry: true });
    expect(h.text("message")).toMatch(/same local network/);
    expect(h.visible("btn-retry")).toBe(false);
    h.push({ ...base, phase: "refused", message: "Several devices are already waiting.", noRetry: false });
    expect(h.visible("btn-retry")).toBe(true);
    h.push({ ...base, phase: "mismatch", message: "different identity" });
    expect(h.visible("btn-retry")).toBe(false);
  });

  it("initial state from ready() is rendered", async () => {
    const h = load({ ...base, phase: "proving" });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.visible("view-proving")).toBe(true);
  });
});
