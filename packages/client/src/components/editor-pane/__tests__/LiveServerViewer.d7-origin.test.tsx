/**
 * LiveServerViewer on the capability origin (D7), local operator (dashboard at `http://localhost:8000`).
 * Hard stop for dashboard-equal origins, legacy version skew, Open ↗, `classifyUrl`, no capability in chrome and the
 * re-mint/touch cadence. See change: serve-live-previews-on-capability-origin
 * (test-plan #E161, #E171, #E174-#E177, #P23).
 */
// @vitest-environment-options {"url":"http://localhost:8000"}
import { classifyUrl } from "@blackbelt-technology/pi-dashboard-shared/url-policy.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewProvenance } from "../../../lib/access-grants/preview-provenance.js";
import { resetExposureStore } from "../../../lib/live-preview/exposure-store.js";
import { type FakeServers, installFakeLiveServer } from "./live-fake-api.js";

const state = vi.hoisted(() => ({ apiBase: "" }));
vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => state.apiBase }));

import LiveServerViewer from "../LiveServerViewer.js";

const TWELVE_HOURS = 12 * 60 * 60_000;
const LABEL = "k7q4mzxa2bcdefghijklmnopqr";
const ORIGIN = `http://${LABEL}.localhost:8000`;
const SECRET = (n: number) => `K${n}`.padEnd(30, "k");
const PID = "P".repeat(22);
const DASH = "http://localhost:8000";
const API = "http://192.168.1.5:9000";

type Json = Record<string, unknown>;
type Respond = (n: number, body: Json) => Json;

let fake: FakeServers;
let mintBodies: Json[];
let opened: { location: { href: string }; opener: unknown; close: ReturnType<typeof vi.fn> };
let openSpy: ReturnType<typeof vi.spyOn>;

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const iframe = () => screen.queryByTestId("live-iframe") as HTMLIFrameElement | null;
const agent = (ui: ReactNode) => <PreviewProvenance autoOpened>{ui}</PreviewProvenance>;
const agentPort = (path = "live:http://localhost:5173/") => agent(<LiveServerViewer path={path} />);
const policyOf = (body: Json) => ({ egress: body.egress === "open" ? "open" : "restricted", scripts: body.scripts === true });

/** A well-formed mint answer for `tier` (override any field). */
const mintJson = (n: number, body: Json, over: Json = {}): Json => ({
  ok: true,
  success: true,
  tier: 1,
  origin: ORIGIN,
  path: "/",
  expiresAt: Date.now() + TWELVE_HOURS,
  tokenId: `tid${n}`,
  policy: policyOf(body),
  ...over,
});

/** Route every `/capability` POST through `respond`; everything else keeps the shared fake server. */
function installMint(respond: Respond): void {
  const inner = globalThis.fetch;
  let n = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/capability")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Json;
      mintBodies.push(body);
      n += 1;
      const payload = respond(n, body);
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }
    return inner(input, init);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetExposureStore();
  state.apiBase = "";
  mintBodies = [];
  fake = installFakeLiveServer();
  opened = { location: { href: "" }, opener: {}, close: vi.fn() };
  openSpy = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
});
afterEach(() => {
  cleanup();
  fake.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("T.E161 / #E161 canonical-equal origin is refused, never framed", () => {
  it("the page is served from http://localhost:8000 (fixture sanity)", () => {
    expect(window.location.origin).toBe(DASH);
  });

  it("mint `http://LOCALHOST.:8000` (case + trailing dot) → no iframe, error text shown", async () => {
    installMint((n, body) => mintJson(n, body, { origin: "http://LOCALHOST.:8000" }));
    render(agentPort());
    await flush();
    expect(iframe()).toBeNull();
    expect(screen.getByTestId("live-error").textContent).toContain("preview response rejected");
    expect(mintBodies).toHaveLength(1);
  });

  it("mint `http://localhost:8000` (string-equal) → no iframe", async () => {
    installMint((n, body) => mintJson(n, body, { origin: DASH }));
    render(agentPort());
    await flush();
    expect(iframe()).toBeNull();
    expect(screen.getByTestId("live-error")).toBeTruthy();
  });

  it("an apiBase origin of `http://localhost` vs mint `http://localhost:80` (default-port elision) → no iframe", async () => {
    state.apiBase = "http://localhost";
    installMint((n, body) => mintJson(n, body, { origin: "http://localhost:80" }));
    render(agentPort());
    await flush();
    expect(iframe()).toBeNull();
    expect(screen.getByTestId("live-error").textContent).toContain("preview response rejected");
  });

  it("apiBase `http://localhost:8000` vs mint `http://LOCALHOST.:8000` → no iframe (the row's literal case)", async () => {
    state.apiBase = DASH;
    installMint((n, body) => mintJson(n, body, { origin: "http://LOCALHOST.:8000" }));
    render(agentPort());
    await flush();
    expect(iframe()).toBeNull();
    expect(screen.getByTestId("live-error")).toBeTruthy();
  });

  it("a distinct origin IS framed (the refusal is not blanket)", async () => {
    installMint((n, body) => mintJson(n, body));
    render(agentPort());
    await flush();
    expect(iframe()?.getAttribute("src")).toBe(`${ORIGIN}/`);
  });
});

describe("T.E171 / #E171 hard stop invariant over randomised mint responses", () => {
  // mulberry32: deterministic, so a failure reproduces.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const dotless = (o: string) => o.replace(/\.(?=(:\d+)?$)/, "");
  const originOf = (src: string) => dotless(new URL(src, window.location.href).origin);

  const DASH_EQUAL = [DASH, "http://LOCALHOST:8000", "http://localhost.:8000", "http://LOCALHOST.:8000", "http://localhost:8000/"];
  const API_EQUAL = [API, "http://192.168.1.5:9000/", "http://192.168.1.5.:9000"];
  const VALID = [ORIGIN, "http://192.168.1.5:9001", "https://a.preview.example.com", "http://localhost:8001", "http://x.localhost:8000"];
  const JUNK = ["null", "", "javascript:x", "http://u:p@x.localhost:8000", "ftp://x.localhost"];
  const OWN = new Set([dotless(DASH), dotless(API)]);

  const isEquivalentToOwn = (tier: unknown, origin: string) => typeof tier === "number" && tier <= 4 && (DASH_EQUAL.includes(origin) || API_EQUAL.includes(origin));

  const responderFor = (tier: 1 | 2 | 3 | 4 | 5 | "legacy", origin: string, k: string): Respond => (n, body) => {
    if (tier === 5) return mintJson(n, body, { tier: 5, origin: undefined, path: `/preview/${PID}/` });
    if (tier === "legacy") return mintJson(n, body, { tier: undefined, origin: undefined, path: `/live/abc12345/~c/${"T".repeat(22)}/` });
    return mintJson(n, body, { tier, origin, path: tier === 3 ? `/?k=${k}` : "/" });
  };

  /** The invariant for one rendered case. */
  const assertInvariant = (id: string, tier: 1 | 2 | 3 | 4 | 5 | "legacy", origin: string, frame: HTMLIFrameElement | null): void => {
    if (isEquivalentToOwn(tier, origin)) expect({ id, tier, origin, framed: frame !== null }).toEqual({ id, tier, origin, framed: false });
    if (!frame) return;
    const srcOrigin = originOf(frame.getAttribute("src") ?? "");
    const sameOrigin = (frame.getAttribute("sandbox") ?? "").split(/\s+/).includes("allow-same-origin");
    const own = OWN.has(srcOrigin);
    if (typeof tier === "number" && tier <= 4) expect({ id, tier, srcOrigin, own }).toEqual({ id, tier, srcOrigin, own: false });
    if (sameOrigin) expect({ id, tier, srcOrigin, own }).toEqual({ id, tier, srcOrigin, own: false });
  };

  it("a rendered tier 1-4 src never lands on the dash/apiBase origin; allow-same-origin never pairs with a dash-origin src", async () => {
    state.apiBase = API;
    const r = rng(0xc0ffee);
    let framed = 0;
    for (let i = 0; i < 48; i++) {
      const tier = pick(r, [1, 2, 3, 4, 5, "legacy"] as const);
      const origin = pick(r, [...DASH_EQUAL, ...API_EQUAL, ...VALID, ...VALID, ...JUNK]);
      installMint(responderFor(tier, origin, SECRET(i)));
      const { unmount } = render(agentPort());
      await flush();
      const frame = iframe();
      assertInvariant(String(i), tier, origin, frame);
      if (frame) framed += 1;
      unmount();
      cleanup();
      fake.restore();
      mintBodies = [];
      fake = installFakeLiveServer();
    }
    // The generator exercised both branches (the invariant is not vacuously true).
    expect(framed).toBeGreaterThan(5);
    expect(48 - framed).toBeGreaterThan(5);
  });
});

describe("T.E174 / #E174 legacy flat shape from an old server (version skew)", () => {
  const LEGACY = `/live/stat1234/~c/${"L".repeat(24)}/`;
  const staticViewer = () => agent(<LiveServerViewer path="static:/p/m/a/index.html" cwd="/p" />);

  for (const apiBase of ["", API]) {
    it(`apiBase=${JSON.stringify(apiBase)}: sends accept, frames apiBase + path, no allow-same-origin, hint available`, async () => {
      state.apiBase = apiBase;
      fake.egress.rootAbsolute = true;
      installMint((n, body) => ({ success: true, path: LEGACY, expiresAt: Date.now() + TWELVE_HOURS, tokenId: `tid${n}`, policy: policyOf(body) }));
      render(staticViewer());
      await flush();
      expect(mintBodies[0]?.accept).toEqual(["origin", "preview"]);
      const frame = iframe();
      expect(frame?.getAttribute("src")).toBe(`${apiBase}${LEGACY}index.html`);
      expect(frame?.getAttribute("sandbox")).not.toContain("allow-same-origin");
      expect(frame?.getAttribute("sandbox")).toContain("allow-scripts");
      // Legacy statics keep the root-absolute hint (and never the tier-5 base strip).
      expect(screen.getByTestId("live-hint-root-absolute")).toBeTruthy();
      expect(screen.queryByTestId("live-hint-base-path")).toBeNull();
    });
  }

  it("a legacy port target frames apiBase + path and stays opaque", async () => {
    state.apiBase = API;
    installMint((n, body) => ({ ok: true, path: LEGACY, expiresAt: Date.now() + TWELVE_HOURS, tokenId: `tid${n}`, policy: policyOf(body) }));
    render(agentPort("live:http://localhost:5173/report.html"));
    await flush();
    expect(iframe()?.getAttribute("src")).toBe(`${API}${LEGACY}report.html`);
    expect(iframe()?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });
});

describe("T.E175 / #E175 Open ↗ (local operator)", () => {
  const launchUserPort = async () => {
    render(<LiveServerViewer />);
    fireEvent.click(screen.getByTestId("live-confirm"));
    await flush();
  };

  it("(local, user-added port) opens http://localhost:<port>/<deep> directly: no mint, no popup shim", async () => {
    installMint((n, body) => mintJson(n, body));
    await launchUserPort();
    const open = screen.getByTestId("live-open");
    expect(open.getAttribute("href")).toBe("http://localhost:5173/");
    expect(open.getAttribute("target")).toBe("_blank");
    const mintsBefore = mintBodies.length;
    fireEvent.click(open);
    await flush();
    expect(mintBodies).toHaveLength(mintsBefore);
    expect(openSpy).not.toHaveBeenCalledWith("about:blank", "_blank");
  });

  it("(local, user-added port) the deep path rides on the direct URL", async () => {
    installMint((n, body) => mintJson(n, body));
    await launchUserPort();
    const input = screen.getByTestId("live-address") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/docs/a b?x=1" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await flush();
    expect(screen.getByTestId("live-open").getAttribute("href")).toBe("http://localhost:5173/docs/a%20b?x=1");
  });

  it("(local, agent preset, T1) opens a FRESH mint equal to origin + base + deep (the frame's URL)", async () => {
    const base = `/preview/${PID}/`;
    installMint((n, body) => mintJson(n, body, { base }));
    render(agentPort("live:http://localhost:5173/report.html?x=1"));
    await flush();
    const frameSrc = iframe()?.getAttribute("src");
    expect(frameSrc).toBe(`${ORIGIN}${base}report.html?x=1`);
    expect(mintBodies).toHaveLength(1);
    fireEvent.click(screen.getByTestId("live-open"));
    await flush();
    expect(mintBodies).toHaveLength(2); // freshly minted for the new window
    expect(opened.location.href).toBe(frameSrc);
    expect(opened.opener).toBeNull();
  });

  it("(any, static, T1) opens a fresh mint equal to the frame's URL", async () => {
    installMint((n, body) => mintJson(n, body));
    render(agent(<LiveServerViewer path="static:/p/m/a/index.html" cwd="/p" />));
    await flush();
    const frameSrc = iframe()?.getAttribute("src");
    expect(frameSrc).toBe(`${ORIGIN}/index.html`);
    fireEvent.click(screen.getByTestId("live-open"));
    await flush();
    expect(mintBodies).toHaveLength(2);
    expect(opened.location.href).toBe(frameSrc);
  });

  it("(T3) opens with a NEW `k` different from the frame's, same `to=`", async () => {
    installMint((n, body) => mintJson(n, body, { tier: 3, origin: "http://192.168.1.5:8100", path: `/?k=${SECRET(n)}` }));
    render(agentPort("live:http://localhost:5173/a/b"));
    await flush();
    const frameUrl = new URL(iframe()?.getAttribute("src") ?? "");
    expect(frameUrl.searchParams.get("k")).toBe(SECRET(1));
    fireEvent.click(screen.getByTestId("live-open"));
    await flush();
    const openedUrl = new URL(opened.location.href);
    expect(openedUrl.origin).toBe(frameUrl.origin);
    expect(openedUrl.searchParams.get("k")).toBe(SECRET(2));
    expect(openedUrl.searchParams.get("k")).not.toBe(frameUrl.searchParams.get("k"));
    expect(openedUrl.searchParams.get("to")).toBe("/a/b");
    expect(frameUrl.searchParams.get("to")).toBe("/a/b");
  });
});

describe("T.E176 / #E176 classifyUrl gates what Open ↗ may navigate to", () => {
  const ALLOWED = ["http://abc.localhost:8000/", "https://abc.preview.example.com/", "http://10.0.0.5:8101/?k=x"];
  const REFUSED = ["javascript:x", "file:///etc/passwd"];

  it("classifier: the three origins are allowed, javascript: and file: are blocked", () => {
    for (const u of ALLOWED) expect(classifyUrl(u, DASH)).not.toBe("blocked");
    for (const u of REFUSED) expect(classifyUrl(u, DASH)).toBe("blocked");
  });

  it("useOpenExternal navigates the new window to each allowed capability URL", async () => {
    const cases: Array<[Json, string]> = [
      [{ tier: 1, origin: "http://abc.localhost:8000", path: "/" }, "http://abc.localhost:8000/"],
      [{ tier: 2, origin: "https://abc.preview.example.com", path: "/" }, "https://abc.preview.example.com/"],
      [{ tier: 3, origin: "http://10.0.0.5:8101", path: `/?k=${SECRET(1)}` }, `http://10.0.0.5:8101/?k=${SECRET(1)}&to=${encodeURIComponent("/")}`],
    ];
    for (const [over, expected] of cases) {
      cleanup();
      opened.location.href = "";
      installMint((n, body) => mintJson(n, body, over));
      render(agentPort());
      await flush();
      fireEvent.click(screen.getByTestId("live-open"));
      await flush();
      expect(opened.location.href).toBe(expected);
      expect(opened.close).not.toHaveBeenCalled();
    }
  });

  it("a javascript: / file: origin never reaches the window: the mint is refused and the window closes", async () => {
    for (const origin of ["javascript:x", "file:///etc/passwd"]) {
      cleanup();
      opened.location.href = "";
      opened.close.mockClear();
      installMint((n, body) => mintJson(n, body, n === 1 ? {} : { origin }));
      render(agentPort());
      await flush();
      expect(iframe()).not.toBeNull(); // the frame mint (#1) was fine
      fireEvent.click(screen.getByTestId("live-open"));
      await flush();
      expect(opened.location.href).toBe("");
      expect(opened.close).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("live-open-error").textContent).toContain("preview response rejected");
    }
  });
});

describe("T.E177 / #E177 no capability in the viewer chrome", () => {
  /** Every place a capability could leak: text, attributes (except the frame's own src) and field values. */
  const textNodes = (): string[] => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node.textContent ?? "");
    return out;
  };
  const attrValues = (el: Element): string[] =>
    Array.from(el.attributes)
      .filter((a) => !(el.tagName === "IFRAME" && a.name === "src"))
      .map((a) => a.value);
  const chromeStrings = (): string[] => {
    const out = textNodes();
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      out.push(...attrValues(el));
      if (el instanceof HTMLInputElement) out.push(el.value);
    }
    return out;
  };
  const leaks = (needle: string) => chromeStrings().filter((s) => s.toLowerCase().includes(needle.toLowerCase()));

  for (const tier of [1, 2, 4]) {
    it(`tier ${tier}: the origin label appears only in the frame src`, async () => {
      installMint((n, body) => mintJson(n, body, { tier }));
      render(agentPort("live:http://localhost:5173/a"));
      await flush();
      expect(iframe()?.getAttribute("src")).toBe(`${ORIGIN}/a`);
      expect(leaks(LABEL)).toEqual([]);
      expect((screen.getByTestId("live-address") as HTMLInputElement).value).not.toContain(LABEL);
    });
  }

  it("tier 3: neither the label nor the one-shot secret is shown", async () => {
    installMint((n, body) => mintJson(n, body, { tier: 3, origin: `http://${LABEL}.localhost:8100`, path: `/?k=${SECRET(7)}` }));
    render(agentPort());
    await flush();
    expect(iframe()).not.toBeNull();
    expect(leaks(LABEL)).toEqual([]);
    expect(leaks(SECRET(7))).toEqual([]);
  });

  it("legacy: the token in the path appears only in the frame src", async () => {
    const token = "TOKEN_ABCDEFGHIJKLMNOPQRSTUV";
    installMint((n, body) => ({ success: true, path: `/live/abc12345/~c/${token}/`, expiresAt: Date.now() + TWELVE_HOURS, tokenId: `tid${n}`, policy: policyOf(body) }));
    render(agentPort());
    await flush();
    expect(iframe()?.getAttribute("src")).toContain(token);
    expect(leaks(token)).toEqual([]);
    expect(leaks("~c")).toEqual([]);
  });

  it("tier 5: ONLY the base strip shows /preview/<pid>/, and nothing else (address bar, titles, labels)", async () => {
    installMint((n, body) => mintJson(n, body, { tier: 5, origin: undefined, path: `/preview/${PID}/` }));
    render(agentPort());
    await flush();
    const hits = chromeStrings().filter((s) => s.includes(PID));
    expect(hits).toEqual([`/preview/${PID}/`]);
    expect(screen.getByTestId("live-base-path").textContent).toBe(`/preview/${PID}/`);
    expect((screen.getByTestId("live-address") as HTMLInputElement).value).not.toContain(PID);
  });
});

describe("T.P23 / #P23 re-mint and touch cadence over 12 h of virtual time", () => {
  const MIN = 60_000;
  it("1 mint at open + 1 near the absolute expiry (11 h 50 min); ≤144 touches; no timers or fetches after unmount", async () => {
    installMint((n, body) => mintJson(n, body)); // every mint is valid 12 h from now
    const { unmount } = render(<LiveServerViewer />); // picker → operator open (no egress polling)
    fireEvent.click(screen.getByTestId("live-confirm"));
    await flush();
    expect(iframe()).not.toBeNull();
    expect(mintBodies).toHaveLength(1);

    await flush(11 * 60 * MIN + 49 * MIN + 59_000);
    expect(mintBodies).toHaveLength(1); // nothing before 11:50:00
    await flush(1_000);
    expect(mintBodies).toHaveLength(2); // the re-mint at expiry − 10 min
    await flush(10 * MIN); // reach exactly 12:00
    expect(mintBodies).toHaveLength(2); // the second token is valid for another 12 h: no third mint in the window

    const touches = fake.callsTo("/touch", "POST").length;
    expect(touches).toBeLessThanOrEqual(144);
    expect(touches).toBeGreaterThanOrEqual(140); // the 5-minute cadence actually ran

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const fetchesAfterUnmount = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await flush(13 * 60 * MIN);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchesAfterUnmount);
  });
});
