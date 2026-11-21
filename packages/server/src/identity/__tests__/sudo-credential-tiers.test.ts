/**
 * `sudo_credential_*` protocol coverage: unions, session ownership and WS tiers.
 * See change: add-sudo-credential-prompt (test-plan #S36).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WS_MESSAGE_TIERS, wsMessageTier } from "@blackbelt-technology/pi-dashboard-shared/ws-message-tiers.js";
import { describe, expect, it } from "vitest";
import { SESSION_OWNED_MESSAGES } from "../ws-message-scope.js";

const ALL = ["request", "response", "cancel", "forget", "dismiss", "cache", "shown"].map((s) => `sudo_credential_${s}`);
const BROWSER_BOUND = ["response", "cancel", "forget", "shown"].map((s) => `sudo_credential_${s}`);

const shared = join(__dirname, "../../../../shared/src");
const protocolSrc = readFileSync(join(shared, "protocol.ts"), "utf8");
const browserSrc = readFileSync(join(shared, "browser-protocol.ts"), "utf8");

describe("sudo_credential_* protocol coverage", () => {
  it("every type is declared in a protocol file", () => {
    for (const t of ALL) {
      expect(protocolSrc.includes(`"${t}"`) || browserSrc.includes(`"${t}"`), t).toBe(true);
    }
  });

  it("browser→server types are session-owned and at tier control", () => {
    for (const t of BROWSER_BOUND) {
      expect(SESSION_OWNED_MESSAGES.has(t), t).toBe(true);
      expect(Object.hasOwn(WS_MESSAGE_TIERS, t), t).toBe(true);
      expect(wsMessageTier(t), t).toBe("control");
    }
  });

  it("server→browser-only types are not browser→server messages", () => {
    for (const t of ["sudo_credential_request", "sudo_credential_dismiss", "sudo_credential_cache"]) {
      expect(SESSION_OWNED_MESSAGES.has(t), t).toBe(false);
      expect(Object.hasOwn(WS_MESSAGE_TIERS, t), t).toBe(false);
    }
  });

  it("the fail-closed rule for unlisted types is unchanged (not control)", () => {
    expect(wsMessageTier("sudo_credential_unknown")).toBe("operate");
  });
});
