import { describe, it, expect } from "vitest";
import {
  generatePKCE,
  generateState,
  getProviderHandler,
  getAllHandlers,
  type AuthCodeHandler,
} from "../auth/provider-auth-handlers.js";

describe("provider-auth-handlers", () => {
  describe("PKCE", () => {
    it("generates verifier and challenge", async () => {
      const pkce = await generatePKCE();
      expect(pkce.verifier).toBeTruthy();
      expect(pkce.challenge).toBeTruthy();
      expect(pkce.verifier).not.toBe(pkce.challenge);
    });

    it("generates different pairs each time", async () => {
      const a = await generatePKCE();
      const b = await generatePKCE();
      expect(a.verifier).not.toBe(b.verifier);
    });
  });

  describe("generateState", () => {
    it("returns a hex string", () => {
      const state = generateState();
      expect(state).toMatch(/^[0-9a-f]+$/);
      expect(state.length).toBe(32);
    });
  });

  describe("registry", () => {
    it("has all 3 providers", () => {
      const handlers = getAllHandlers();
      expect(handlers.length).toBe(3);
    });

    it("gets anthropic handler", () => {
      const h = getProviderHandler("anthropic");
      expect(h).toBeDefined();
      expect(h!.flowType).toBe("auth_code");
      expect(h!.providerId).toBe("anthropic");
    });

    it("gets github-copilot as device_code", () => {
      const h = getProviderHandler("github-copilot");
      expect(h).toBeDefined();
      expect(h!.flowType).toBe("device_code");
    });

    it("returns undefined for unknown provider", () => {
      expect(getProviderHandler("unknown")).toBeUndefined();
    });
  });

  describe("auth URL builders", () => {
    const dummyPkce = { verifier: "v", challenge: "c" };

    it("anthropic builds correct auth URL", () => {
      const h = getProviderHandler("anthropic") as AuthCodeHandler;
      const url = h.buildAuthUrl("http://localhost:9998/callback", "test-state", dummyPkce);
      expect(url).toContain("claude.ai/oauth/authorize");
      expect(url).toContain("code_challenge=c");
      expect(url).toContain("state=test-state");
      expect(url).toContain("redirect_uri=");
    });

    it("openai-codex builds correct auth URL", () => {
      const h = getProviderHandler("openai-codex") as AuthCodeHandler;
      const url = h.buildAuthUrl("http://localhost:9998/callback", "s", dummyPkce);
      expect(url).toContain("auth.openai.com/oauth/authorize");
      expect(url).toContain("codex_cli_simplified_flow=true");
    });
  });
});
