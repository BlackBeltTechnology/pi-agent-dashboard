/**
 * Bundled remote-connect.html DOM behaviour (jsdom).
 * See change: add-electron-server-windows (test-plan F3; spec "Remote-connect window").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { type DomWindow, JSDOM } from "./jsdom-shim.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "..", "renderer", "remote-connect.html"), "utf8");

const F = `sha256:${"A".repeat(43)}`;
const G = `sha256:${"B".repeat(43)}`;

const servers = () => ({
  paired: [
    { fingerprint: F, label: "home-imac", shortFp: "sha256:AAAAAAAAAAAAAAAA", state: "paired", open: false, remembered: true, host: "192.168.16.204:8000" },
    { fingerprint: G, label: "lab-box", shortFp: "sha256:BBBBBBBBBBBBBBBB", state: "needs-pairing", open: false, remembered: true },
  ],
  discovered: [
    { key: "x", name: "x-server", host: "10.0.0.2", port: 8000, addresses: [], state: "not-paired" },
    { key: "y", name: "y-server", host: "10.0.0.3", port: 8000, addresses: [], state: "identity-not-advertised" },
  ],
  recent: [{ url: "http://a.example:8000", lastUsed: new Date().toISOString() }],
});

async function load() {
  let changed: ((s: unknown) => void) | undefined;
  const api = {
    getState: vi.fn(async () => ({ mode: "standalone", recent: servers().recent })),
    listServers: vi.fn(async () => servers()),
    onServersChanged: vi.fn((cb: (s: unknown) => void) => {
      changed = cb;
      return () => {};
    }),
    probe: vi.fn(async () => ({ ok: true })),
    connect: vi.fn(async () => {}),
    useLocal: vi.fn(async () => {}),
    forget: vi.fn(async () => []),
    close: vi.fn(),
    openServer: vi.fn(async () => ({ ok: true })),
    connectServer: vi.fn(async () => ({ ok: true, pairing: true })),
    openInWindow: vi.fn(async () => ({ ok: true, pairing: true })),
    forgetServer: vi.fn(async () => ({ ok: true, message: "home-imac was forgotten." })),
    pairAgain: vi.fn(async () => ({ ok: true, pairing: true })),
  };
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(w: DomWindow) {
      (w as unknown as { remoteConnect: unknown }).remoteConnect = api;
    },
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const doc = dom.window.document;
  return { dom, doc, api, push: (s: unknown) => changed?.(s), q: (sel: string) => Array.from(doc.querySelectorAll(sel)) as HTMLElement[] };
}

const rowText = (li: Element) => li.textContent ?? "";
const buttons = (li: Element) => Array.from(li.querySelectorAll("button")).map((b) => b.textContent);

describe("remote-connect window lists (F3)", () => {
  it("four section headings, state words per row, per-state actions", async () => {
    const h = await load();
    expect(h.q("section h2").map((e) => e.textContent)).toEqual(["Paired servers", "Discovered on this network", "Enter a URL", "Recent remote dashboards"]);
    const [paired, needs] = h.q("#paired-list li");
    expect(rowText(paired!)).toContain("home-imac");
    expect(rowText(paired!)).toContain("Paired");
    expect(buttons(paired!)).toEqual(["Open", "Forget"]);
    expect(rowText(needs!)).toContain("Needs pairing");
    expect(buttons(needs!)).toEqual(["Pair again", "Forget"]);
    const [x, y] = h.q("#discovered-list li");
    expect(rowText(x!)).toContain("Not paired");
    expect(buttons(x!)).toEqual(["Connect"]);
    expect(rowText(y!)).toContain("Identity not advertised");
    // recent keeps "Use as remote dashboard" (row click) and adds "Open in window"
    const recent = h.q("#server-list li").map(rowText);
    expect(recent.join("|")).toContain("http://a.example:8000");
    expect(h.q("#server-list [data-action=window-url]")).toHaveLength(1);
    expect(h.doc.getElementById("connect-btn")!.textContent).toBe("Use as remote dashboard");
    expect(h.doc.getElementById("window-btn")!.textContent).toBe("Open in window");
  });

  it("a push removes a discovered row without reload", async () => {
    const h = await load();
    h.push({ ...servers(), discovered: servers().discovered.filter((d) => d.key !== "x") });
    const names = h.q("#discovered-list li").map(rowText).join("|");
    expect(names).not.toContain("x-server");
    expect(names).toContain("y-server");
    expect(h.api.getState).toHaveBeenCalledTimes(1); // no refresh()/reload
  });

  it("empty lists say so", async () => {
    const h = await load();
    h.push({ paired: [], discovered: [], recent: [] });
    expect(h.q("#paired-list li")[0]!.textContent).toMatch(/No paired servers/);
    expect(h.q("#discovered-list li")[0]!.textContent).toMatch(/No other dashboards/);
  });

  it("actions route to the right bridge calls; none of them relaunch (connect/useLocal untouched)", async () => {
    const h = await load();
    h.q("#paired-list [data-action=open]")[0]!.click();
    h.q("#paired-list [data-action=pair-again]")[0]!.click();
    h.q("#paired-list [data-action=forget]")[0]!.click();
    h.q("#discovered-list [data-action=connect]")[0]!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.api.openServer).toHaveBeenCalledWith(F);
    expect(h.api.pairAgain).toHaveBeenCalledWith(G);
    expect(h.api.forgetServer).toHaveBeenCalledWith(F);
    expect(h.api.connectServer).toHaveBeenCalledWith("x");
    expect(h.api.connect).not.toHaveBeenCalled();
    expect(h.api.useLocal).not.toHaveBeenCalled();
  });

  it("manual 'Open in window' uses openInWindow (no probe required), 'Use as remote dashboard' still needs a probe", async () => {
    const h = await load();
    const input = h.doc.getElementById("remote-url") as HTMLInputElement;
    const win = h.doc.getElementById("window-btn") as HTMLButtonElement;
    const connect = h.doc.getElementById("connect-btn") as HTMLButtonElement;
    expect(win.disabled).toBe(true);
    input.value = "10.0.0.5:8000";
    input.dispatchEvent(new h.dom.window.Event("input"));
    expect(win.disabled).toBe(false);
    expect(connect.disabled).toBe(true);
    win.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.api.openInWindow).toHaveBeenCalledWith("http://10.0.0.5:8000");
    expect(h.api.connect).not.toHaveBeenCalled();
  });

  it("untrusted names are text, not markup; failures are explained in words", async () => {
    const h = await load();
    h.push({ ...servers(), discovered: [{ key: "z", name: "<img src=x onerror=alert(1)>", host: "h", port: 1, addresses: [], state: "not-paired" }] });
    expect(h.doc.querySelector("#discovered-list img")).toBeNull();
    h.api.connectServer.mockResolvedValueOnce({ ok: false, reason: "identity_mismatch" } as never);
    h.q("#discovered-list [data-action=connect]")[0]!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.doc.getElementById("status")!.textContent).toMatch(/different identity/);
  });
});
