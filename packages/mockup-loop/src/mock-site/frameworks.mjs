// @ts-check
// Component-framework adapters for the mock site. Pure (no node imports): shared by
// the node plugin (dedupe + pre-bundling) and the browser shell (unknown-framework
// page error). Fixtures, scripts and the cursor overlay sit OUTSIDE the adapter.
// See change: add-mock-site-exact-env (design D8).

/** @typedef {{ dedupe: string[], include: string[] }} FrameworkAdapter */

/** @type {Record<string, FrameworkAdapter>} */
export const FRAMEWORK_ADAPTERS = {
  react: {
    dedupe: ["react", "react-dom"],
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
};

export const DEFAULT_FRAMEWORK = "react";

/**
 * Page error for a mock whose `framework` has no adapter; null when supported.
 * @param {unknown} framework
 */
export function frameworkProblem(framework) {
  const name = framework === undefined ? DEFAULT_FRAMEWORK : String(framework);
  if (Object.hasOwn(FRAMEWORK_ADAPTERS, name)) return null;
  return `framework "${name}" has no mock-site adapter (supported: ${Object.keys(FRAMEWORK_ADAPTERS).join(", ")})`;
}
