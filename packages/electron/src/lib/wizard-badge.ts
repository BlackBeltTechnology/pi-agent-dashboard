/**
 * Wizard progress row badge classification.
 *
 * The first-run wizard renders each recommended-extension install step as
 * a progress row. A completed row can carry one of three distinct states
 * the user should visually distinguish:
 *
 *   - `"bundled"`  — this extension was activated from the pre-bundled
 *                     source tree shipped inside the Electron installer.
 *                     Emitted by `installBundledExtensions()` as `output:
 *                     "Bundled"` and by `installRecommendedExtensions()`'s
 *                     skip path as `output: "Already installed (bundled)"`.
 *   - `"system"`   — this extension was already present on disk from an
 *                     earlier (non-bundled) install, typically a user
 *                     running the pi CLI before opening the Electron app.
 *                     Emitted as `output: "Already installed (system)"` or
 *                     `output: "Already installed"` (bundled activation
 *                     skip-if-present case).
 *   - `null`       — a normal install-from-npm/git performed during this
 *                     wizard run. No badge.
 *
 * This is the single source of truth consumed both by the wizard's inline
 * JS (duplicated literally to keep the HTML standalone) and by unit tests.
 */
export type WizardBadge = "bundled" | "system" | null;

export function classifyProgressBadge(output: string | undefined): WizardBadge {
	if (!output) return null;
	if (output === "Bundled" || output === "Already installed (bundled)") {
		return "bundled";
	}
	if (output === "Already installed (system)" || output === "Already installed") {
		return "system";
	}
	return null;
}
