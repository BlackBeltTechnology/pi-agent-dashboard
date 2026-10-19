/**
 * Path resolution for the agent path gate — re-export of the shared pi-parity resolver.
 * The implementation lives in `packages/shared/src/tool-path-resolve.ts` so the
 * `path-containment-guard` extension and this gate share one copy of the
 * realpath / case-folding rules.
 * See change: ask-agent-file-access-in-chat (D2), add-path-containment-guard-extension (D1).
 */
export * from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";
