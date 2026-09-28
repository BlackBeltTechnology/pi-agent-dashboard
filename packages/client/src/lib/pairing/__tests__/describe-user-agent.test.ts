/**
 * UA → label (change: add-pairing-approval-dialog, test-plan E7).
 * Exemplar: single-encoder.test.ts (pure lib unit).
 */
import { describe, expect, it } from "vitest";
import { describeUserAgent, deviceNameFromUserAgent } from "../describe-user-agent.js";

const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  electron:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) pi-dashboard/0.8.0 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36",
};

describe("describeUserAgent (E7)", () => {
  it.each([
    [UA.chromeWin, "Chrome 140 on Windows"],
    [UA.safariIos, "Safari on iPhone"],
    [UA.firefoxLinux, "Firefox on Linux"],
    [UA.edgeWin, "Edge on Windows"],
    [UA.electron, "pi-dashboard app"],
    ["", "Unknown browser"],
    ["<script>alert(1)</script>", "Unknown browser"],
  ])("%s → %s", (ua, want) => {
    expect(describeUserAgent(ua)).toBe(want);
  });

  it("undefined UA → Unknown browser", () => {
    expect(describeUserAgent(undefined)).toBe("Unknown browser");
  });

  it("name prefill drops the version", () => {
    expect(deviceNameFromUserAgent(UA.chromeWin)).toBe("Chrome on Windows");
  });
});
