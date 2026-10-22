/**
 * Navigation-intent wire types (change: harden-client-sinks, design D10).
 *
 * `POST /api/nav-intent`         body {@link NavIntentRequest} → `{ success, ni }`
 * `POST /api/nav-intent/verify`  body {@link NavIntentVerifyRequest} → `{ success, ok }`
 *
 * The `ni` value carries only an expiry and a MAC; the kind and target ride in
 * the request body (from the route), never inside `ni`.
 */
import type { ViewTarget } from "./types.js";

export type NavIntentKind = "url-view" | "file-view";
export type NavIntentTarget = { url: string } | { cwd: string; path: string };

export interface NavIntentRequest {
  kind: NavIntentKind;
  target: NavIntentTarget;
}

export interface NavIntentVerifyRequest extends NavIntentRequest {
  ni: string;
}

/** The kind + target a route-backed overlay for `view` binds. */
export function navIntentRequestFor(view: ViewTarget): NavIntentRequest {
  return view.kind === "file"
    ? { kind: "file-view", target: { cwd: view.cwd, path: view.path } }
    : { kind: "url-view", target: { url: view.url } };
}
