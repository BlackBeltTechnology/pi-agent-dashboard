/** Redaction helper table (#X6 helper half). See change: add-browser-editor-pane-tab. */
import { describe, expect, it } from "vitest";
import { AuditRing } from "../audit.js";
import { PLAYWRIGHT_EXTENSION_ID } from "../connect.js";
import { isRelayConnectPage, redactExtensionUrl } from "../redact.js";

const connect = `chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/connect.html`;

describe("redactExtensionUrl", () => {
  it.each([
    [`${connect}?mcpRelayUrl=ws://x/guid&token=T#f`, connect],
    [`chrome-extension://abc/page.html?x=1#f`, "chrome-extension://abc/page.html"],
    [`CHROME-EXTENSION://abc/p?x=1`, "CHROME-EXTENSION://abc/p"],
    ["https://a.test/p?q=1#h", "https://a.test/p?q=1#h"],
    ["about:blank", "about:blank"],
    ["", ""],
  ])("%s", (inp, want) => expect(redactExtensionUrl(inp)).toBe(want));
});

describe("isRelayConnectPage", () => {
  it("matches the connect page regardless of query/fragment/case", () => {
    expect(isRelayConnectPage(`${connect}?token=T`)).toBe(true);
    expect(isRelayConnectPage(`${connect}#x`)).toBe(true);
    expect(isRelayConnectPage(connect.toUpperCase())).toBe(true);
  });
  it("does not match other pages or extensions", () => {
    expect(isRelayConnectPage("chrome-extension://other/connect.html")).toBe(false);
    expect(isRelayConnectPage(`chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/other.html`)).toBe(false);
    expect(isRelayConnectPage("https://a.test/connect.html")).toBe(false);
    expect(isRelayConnectPage(undefined)).toBe(false);
  });
});

describe("audit ring redacts extension URLs and accepts new kinds", () => {
  it("strips the token/guid query from detail; open + dropped kinds are valid", () => {
    const ring = new AuditRing();
    ring.append({ profileDirectory: "p", instanceId: "i", kind: "navigate", detail: `${connect}?token=SECRET&mcpRelayUrl=ws://x/GUID` });
    ring.append({ profileDirectory: "p", instanceId: "i", kind: "open", detail: "tab:1 accepted" });
    ring.append({ profileDirectory: "p", instanceId: "i", kind: "dropped", detail: "Browser.setDownloadBehavior" });
    const all = JSON.stringify(ring.list());
    expect(all).not.toContain("SECRET");
    expect(all).not.toContain("GUID");
    expect(ring.list().map((e) => e.kind)).toEqual(["dropped", "open", "navigate"]);
  });
});
