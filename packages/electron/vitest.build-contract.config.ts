import { defineConfig } from "vitest/config";

/**
 * Second vitest project for packages/electron, scoped to the BUILD-CONTRACT
 * tests only.
 *
 * Why it exists: `packages/electron` as a whole is deliberately excluded from
 * the root `test.projects` list because it carries pre-existing orphaned tests
 * that depend on ambient PATH/mocks never wired up (see vitest.config.ts at the
 * repo root). But the tests below pin the SHIPPED build contract — the Electron
 * version pin, the macOS floor, the update-stream gate — and a gate that no CI
 * job runs is not a gate. So they are collected here, by explicit filename,
 * and this config IS registered at the root.
 *
 * Everything listed must be pure: config/text/fixture assertions and pure
 * predicates only, no ambient environment, no Electron runtime. Adding a test
 * that needs mocks belongs in vitest.config.ts (the full, non-CI project),
 * not here.
 *
 * See change: upgrade-electron-runtime.
 */
export default defineConfig({
	test: {
		name: "electron-build-contract",
		include: [
			"src/__tests__/electron-version-pin.test.ts",
			"src/__tests__/macos-floor-check.test.ts",
			"src/__tests__/update-min-system-version.test.ts",
			"src/__tests__/build-config-parity.test.ts",
			"src/__tests__/forge-config-windows-version.test.ts",
		],
		environment: "node",
		pool: "forks",
		// Must match the repo's dominant project group. The root runner refuses to
		// group two projects that disagree on maxWorkers under the same
		// sequence.groupOrder (see packages/kb-extension/vitest.config.ts, which
		// takes the other escape hatch). These tests are pure and fast, so the
		// shared "50%" group is the right home — unlike this package's OTHER
		// config, which needs maxWorkers: 1.
		maxWorkers: "50%",
		globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
	},
});
