/**
 * E18 — the runtime's public OAuth mirrors stay mutually assignable with the
 * server's `pi-oauth-types`. A drift fails `tsc` (and this file's
 * `expectTypeOf` checks). See change: expose-plugin-credential-and-oauth-seams (D4).
 */
import type {
  PluginLoginEvent,
  PluginLoginInteraction,
  PluginLoginPrompt,
  PluginOAuthCredential,
  PluginOAuthLoginFlow,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { describe, expectTypeOf, it } from "vitest";
import type {
  LoginEvent,
  LoginInteraction,
  LoginPrompt,
  OAuthCredential,
  OAuthLoginFlow,
} from "../auth/pi-oauth-types.js";

describe("plugin OAuth type mirrors (E18)", () => {
  it("are mutually assignable with the server types", () => {
    expectTypeOf<LoginPrompt>().toExtend<PluginLoginPrompt>();
    expectTypeOf<PluginLoginPrompt>().toExtend<LoginPrompt>();
    expectTypeOf<LoginEvent>().toExtend<PluginLoginEvent>();
    expectTypeOf<PluginLoginEvent>().toExtend<LoginEvent>();
    expectTypeOf<LoginInteraction>().toExtend<PluginLoginInteraction>();
    expectTypeOf<PluginLoginInteraction>().toExtend<LoginInteraction>();
    expectTypeOf<OAuthCredential>().toExtend<PluginOAuthCredential>();
    expectTypeOf<PluginOAuthCredential>().toExtend<OAuthCredential>();
    expectTypeOf<OAuthLoginFlow>().toExtend<PluginOAuthLoginFlow>();
    expectTypeOf<PluginOAuthLoginFlow>().toExtend<OAuthLoginFlow>();
  });
});
