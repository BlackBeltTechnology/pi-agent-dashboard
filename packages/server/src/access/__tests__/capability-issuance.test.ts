import { afterEach, describe, expect, it } from "vitest";
import type { CorsOriginOptions } from "../../auth/cors-origin.js";
import { shouldIssuePromptCapability, type UpgradeHeaders } from "../capability-issuance.js";
import { __resetPromptChannels, GRANT_CHANNEL_HEADER, issuePromptChannel, maySuspend } from "../prompt-channel.js";

/**
 * Prompt-capability issuance (change: add-access-grant-dialog, tasks 2b.1 + 3.5;
 * test-plan #E1-#E4).
 *
 * Issuance is gated on browser-shaped provenance: a non-absent admitted Origin
 * AND a qualifying Origin-vs-Host site relation (Chrome sends no Sec-Fetch-Site
 * on a WebSocket upgrade, so the relation is derived; a header that IS present
 * can still refuse). The 3.5 suite then replays each recorded
 * defeat and asserts it is refused SUSPENSION, which is the property the defeats
 * were about.
 */

afterEach(() => __resetPromptChannels());

const DASH = "http://127.0.0.1:8000";

const opts = (over: Partial<CorsOriginOptions> = {}): CorsOriginOptions => ({
  configuredOrigins: [],
  trustedNetworks: [],
  hostGateMode: "report",
  ...over,
});

const upgrade = (over: UpgradeHeaders): UpgradeHeaders => ({
  host: "127.0.0.1:8000",
  origin: DASH,
  "sec-fetch-site": "same-origin",
  ...over,
});

/**
 * The end-to-end question 3.5 asks: can this connection end up holding a
 * capability that lets its request be suspended? Issue iff the policy says so,
 * then ask `maySuspend` with the capability echoed.
 */
function canSuspend(headers: UpgradeHeaders, o: CorsOriginOptions): boolean {
  if (!shouldIssuePromptCapability(headers, o)) return false;
  const cap = issuePromptChannel("sock");
  return maySuspend({ headers: { [GRANT_CHANNEL_HEADER]: cap } }, o.hostGateMode ?? "report");
}

describe("issuance requires browser-shaped provenance (2b.1)", () => {
  it("#E1 absent Origin: no capability, the D1a defeat", () => {
    const { origin: _omit, ...noOrigin } = upgrade({});
    expect(shouldIssuePromptCapability(noOrigin, opts())).toBe(false);
  });

  it("#E2 admitted same-origin Origin + Sec-Fetch-Site same-origin: issued", () => {
    expect(shouldIssuePromptCapability(upgrade({}), opts())).toBe(true);
  });

  it("#E3 cross-site is issued only for an Origin the ADMISSION rule admits", () => {
    const shell = upgrade({ origin: "https://pi-dashboard.dev", "sec-fetch-site": "cross-site" });
    expect(shouldIssuePromptCapability(shell, opts())).toBe(true);
    const stranger = upgrade({ origin: "https://attacker.example", "sec-fetch-site": "cross-site" });
    expect(shouldIssuePromptCapability(stranger, opts())).toBe(false);
  });

  it("#E3 same-site and none never qualify, even for an admitted Origin", () => {
    expect(shouldIssuePromptCapability(upgrade({ "sec-fetch-site": "same-site" }), opts())).toBe(false);
    expect(shouldIssuePromptCapability(upgrade({ "sec-fetch-site": "none" }), opts())).toBe(false);
  });

  it("#E4 empty Origin (not absent) is refused", () => {
    expect(shouldIssuePromptCapability(upgrade({ origin: "" }), opts())).toBe(false);
  });

  it("missing headers object is refused, not thrown", () => {
    expect(shouldIssuePromptCapability(undefined, opts())).toBe(false);
    expect(shouldIssuePromptCapability({}, opts())).toBe(false);
  });

  it("Chrome's real upgrade shape (Origin, no Sec-Fetch-Site) from the dashboard's own page: issued", () => {
    const { "sec-fetch-site": _omit, ...chrome } = upgrade({});
    expect(shouldIssuePromptCapability(chrome, opts())).toBe(true);
    const lan = { host: "mac.local:8000", origin: "http://mac.local:8000" };
    expect(shouldIssuePromptCapability(lan, opts())).toBe(true);
  });

  it("the neutral shell with no Sec-Fetch-Site is cross-site by derivation: issued", () => {
    expect(shouldIssuePromptCapability({ host: "127.0.0.1:8000", origin: "https://pi-dashboard.dev" }, opts())).toBe(true);
  });

  it("derived same-site is refused: another loopback port, or the same hostname on another port (Host has no scheme, so a scheme-only difference on one port is the same server)", () => {
    // Loopback any port is CORS-admitted, so admission alone would issue it.
    expect(shouldIssuePromptCapability({ host: "127.0.0.1:8000", origin: "http://localhost:3000" }, opts())).toBe(false);
    expect(shouldIssuePromptCapability({ host: "localhost:8000", origin: "http://127.0.0.1:5173" }, opts())).toBe(false);
    const configured = opts({ configuredOrigins: ["http://mac.local:3000"] });
    expect(shouldIssuePromptCapability({ host: "mac.local:8000", origin: "http://mac.local:3000" }, configured)).toBe(false);
  });

  it("a present Sec-Fetch-Site that disagrees still refuses (defence in depth)", () => {
    expect(shouldIssuePromptCapability(upgrade({ "sec-fetch-site": "same-site" }), opts())).toBe(false);
  });

  it("an unparseable Host is refused, never treated as cross-site", () => {
    expect(shouldIssuePromptCapability({ host: "evil.com#", origin: "https://pi-dashboard.dev" }, opts())).toBe(false);
  });

  it("a repeated (array) provenance header is refused", () => {
    expect(shouldIssuePromptCapability(upgrade({ origin: [DASH, DASH] }), opts())).toBe(false);
  });
});

describe("3.5 every recorded defeat is refused suspension", () => {
  it("defeat #1: drive-by page with cookies (unadmitted cross-site Origin)", () => {
    const driveBy = upgrade({ origin: "https://evil.example", "sec-fetch-site": "cross-site", cookie: "sid=abc" });
    expect(canSuspend(driveBy, opts({ hostGateMode: "enforce" }))).toBe(false);
  });

  it("defeat #3: stranger zrok share setting the header (wildcard disabled for admission)", () => {
    const zrok = upgrade({ origin: "https://stranger.share.zrok.io", "sec-fetch-site": "cross-site" });
    // Even with the CORS-readability wildcard nominally on, admission ignores it.
    expect(canSuspend(zrok, opts({ hostGateMode: "enforce", allowZrokWildcard: true }))).toBe(false);
  });

  it("defeat #4: a Sec-Fetch-less request from a same-site page (another loopback port)", () => {
    // The header is optional now (Chrome omits it on upgrades); the same-site
    // refusal it carried is re-derived from Origin vs Host.
    const sameSite = { host: "127.0.0.1:8000", origin: "http://localhost:3000" };
    expect(canSuspend(sameSite, opts({ hostGateMode: "enforce" }))).toBe(false);
  });

  it("rebound host in REPORT mode: issuance succeeds (D2 says so) but suspension is refused", () => {
    // Stated honestly: a rebound page is same-origin by Host, so in report mode
    // it IS issued a capability. What stops it is the mode, not the issuance.
    const rebound = upgrade({ host: "attacker.example:8000", origin: "http://attacker.example:8000" });
    expect(shouldIssuePromptCapability(rebound, opts({ hostGateMode: "report" }))).toBe(true);
    expect(canSuspend(rebound, opts({ hostGateMode: "report" }))).toBe(false);
  });

  it("rebound host in ENFORCE mode: not even issued", () => {
    const rebound = upgrade({ host: "attacker.example:8000", origin: "http://attacker.example:8000" });
    expect(shouldIssuePromptCapability(rebound, opts({ hostGateMode: "enforce" }))).toBe(false);
  });

  it("control: the legitimate dashboard under enforce CAN suspend", () => {
    expect(canSuspend(upgrade({}), opts({ hostGateMode: "enforce" }))).toBe(true);
  });
});
