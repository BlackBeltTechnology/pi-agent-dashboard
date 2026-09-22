/**
 * Local structural types for the slice of pi-ai's OAuth surface the server
 * drives.
 *
 * Why local, not imported: pi-coding-agent's index re-exports `ModelRuntime`
 * but NOT pi-ai's `OAuthAuth` / `AuthInteraction` / `AuthPrompt` / `AuthEvent`,
 * and `packages/server` must never import `@earendil-works/pi-ai` — the
 * workspace-hoisted copy (the extension's `>=0.75.5` peer floor) predates the
 * bundled OAuth providers entirely. Declaring the ~40 lines we actually use
 * structurally keeps the server bound to the pi-ai copy pi-coding-agent was
 * built against.
 *
 * Drift risk is covered, not assumed: the adapter tests run every bundled
 * flow's first step against the real runtime, and an unknown prompt kind
 * surfaces at runtime as `status: "error"`, `error: "unsupported prompt:
 * <kind>"` on that one flow rather than a crash.
 * See change: delegate-provider-oauth-to-pi-ai (D1, D3).
 */

import type { OAuthCredential } from "./provider-auth-storage.js";

export type { OAuthCredential };

/** One choice of a pi-ai `select` prompt. */
interface LoginSelectOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * A prompt `login()` raises mid-flow. `signal` is the prompt's OWN
 * cancellation (e.g. a `manual_code` prompt raced against a callback server,
 * aborted when the callback wins) — distinct from the interaction-level
 * `signal`, which cancels the whole login.
 */
export type LoginPrompt = { signal?: AbortSignal } & (
  | { type: "text"; message: string; placeholder?: string }
  | { type: "secret"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: readonly LoginSelectOption[] }
  | { type: "manual_code"; message: string; placeholder?: string }
);

/** A notification `login()` emits. Only `auth_url` and `device_code` are
 * renderable first events; `progress` / `info` only update the message. */
export type LoginEvent =
  | {
      type: "info";
      message: string;
      links?: readonly { url: string; label?: string }[];
    }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

/**
 * The host half of a pi-ai login. `prompt()` resolves with the entered or
 * selected string (a `select` resolves to the option id) and rejects on
 * cancel/abort.
 */
export interface LoginInteraction {
  signal: AbortSignal;
  prompt(prompt: LoginPrompt): Promise<string>;
  notify(event: LoginEvent): void;
}

/** The provider half: `provider.auth.oauth` as the runtime exposes it. */
export interface OAuthLoginFlow {
  name: string;
  isSubscription?: boolean;
  loginLabel?: string;
  login(interaction: LoginInteraction): Promise<OAuthCredential>;
}

/**
 * One sign-in-able provider. `flowType` is a UI hint only — it picks which
 * pane the Add-provider dialog opens first. The pane follows whatever the flow
 * actually emits, so a wrong hint is cosmetic.
 */
export interface OAuthRegistryEntry {
  id: string;
  name: string;
  flowType: "auth_code" | "device_code";
  auth: OAuthLoginFlow;
}
