/**
 * The host import map (design D9/D21): bare specifier → URL of the host-built shim entry
 * (`dist/host/<name>.js`, built by the client's rollup `input`, task 6.3).
 *
 * ONE list shared by the server (`sendIndexWithImportMap`) and the host-API surface snapshot
 * (`scripts/host-api-surface.mjs` `IMPORT_MAP_SPECIFIERS`, kept in lock-step by a server test).
 * Phase 6 appended `embedded-app`, `app-kit/react` and `wouter` (task 7.1).
 *
 * See change: decouple-plugins-from-core (tasks 6.3, 6.4).
 */

/** `@blackbelt-technology/dashboard-plugin-runtime`, built by concatenation (pnpm contract test scans literals for undeclared workspace imports). */
export const HOST_RUNTIME_SPECIFIER = `${"@blackbelt-technology"}/dashboard-plugin-runtime`;

/** `@blackbelt-technology/dashboard-plugin-runtime/embedded-app` (concatenated for the same reason). */
export const HOST_EMBEDDED_APP_SPECIFIER = `${HOST_RUNTIME_SPECIFIER}/embedded-app`;

/** `@blackbelt-technology/pi-dashboard-app-kit/react` (concatenated: shared does not depend on app-kit). */
export const HOST_APP_KIT_REACT_SPECIFIER = `${"@blackbelt-technology"}/pi-dashboard-app-kit/react`;

/** Specifier → shim URL, in map order. */
export const HOST_IMPORT_MAP_IMPORTS: Readonly<Record<string, string>> = Object.freeze({
  react: "/host/react.js",
  "react/jsx-runtime": "/host/react-jsx-runtime.js",
  "react-dom": "/host/react-dom.js",
  "react-dom/client": "/host/react-dom-client.js",
  [HOST_RUNTIME_SPECIFIER]: "/host/runtime.js",
  [HOST_EMBEDDED_APP_SPECIFIER]: "/host/embedded-app.js",
  [HOST_APP_KIT_REACT_SPECIFIER]: "/host/app-kit-react.js",
  wouter: "/host/wouter.js",
});

export const HOST_IMPORT_MAP_SPECIFIERS: readonly string[] = Object.freeze(Object.keys(HOST_IMPORT_MAP_IMPORTS));

/** The static `<script type="importmap">` body. Deterministic: identical bytes on every call. */
export function hostImportMapJson(): string {
  return JSON.stringify({ imports: HOST_IMPORT_MAP_IMPORTS });
}
