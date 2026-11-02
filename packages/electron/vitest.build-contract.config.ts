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
			"src/__tests__/shared-mjs-exports.test.ts",
			"src/__tests__/tray-icon-asset.test.ts",
			"src/__tests__/forge-config-windows-version.test.ts",
			"src/__tests__/assert-packaged-preloads.test.ts",
			"src/__tests__/relativize-extra-resource-links.test.ts",
			"src/__tests__/scan-packaged-symlinks.test.ts",
			// Windows git bundle ships usr/bin/bash.exe (copy of sh.exe). Pure fs on a
			// temp dir. See change: fix-windows-bundled-bash-exe (E24 E25 X1).
			"src/__tests__/ensure-bundled-bash-exe.test.ts",
			// Build-time pi-shell resolution gate: pure helpers + non-win32 no-op.
			// See change: fix-windows-bundled-bash-exe (X10).
			"src/__tests__/assert-bundled-bash-resolvable.test.ts",
			// Bundle GO/NO-GO for @napi-rs/keyring (triple, worker entry, version skew,
			// Linux licence). Pure fs on a temp dir. See change: encrypt-credentials-at-rest (E88, E89).
			"src/__tests__/assert-keyring-bundle.test.ts",
			// macOS static gate for the bundled Node (DLV entitlement parser, paths, smoke policy).
			// See change: encrypt-credentials-at-rest (E90).
			"src/__tests__/assert-mac-bundled-node-keyring.test.ts",
			// Shared bundle prune helper (third-party + first-party rule sets). Pure fs on a
			// temp dir. See change: slim-windows-install-file-count (E1-E7 X1).
			"src/__tests__/prune-bundle.test.ts",
			// Canonical node_modules layout: build-script order, launch helpers, leftover-reader lint.
			// See change: slim-windows-install-file-count (E9 E10 E15 E16).
			"src/__tests__/bundle-layout-static.test.ts",
			// Packaged file-count budget gate (E17-E20).
			"src/__tests__/assert-bundle-file-budget.test.ts",
			// Built-bundle layout gate (E8).
			"src/__tests__/assert-bundle-layout.test.ts",
			"src/__tests__/docker-make-windows-bundle.test.ts",
			// Launch-source precedence is shipped contract too, and the resolver
			// takes every probe by injection (pure). See change:
			// electron-runtime-overlay-updates (test-plan E4, E23).
			"src/lib/__tests__/launch-source.test.ts",
			// Bundled-extension discovery reads the canonical node_modules dir (E12).
			// See change: slim-windows-install-file-count.
			"src/lib/__tests__/bridge-register.test.ts",
			// Doctor reads the bundled server from the node_modules copy (E13).
			"src/lib/__tests__/doctor-bundled-server.test.ts",
			// Runtime-overlay state machine + switchRuntime (all process/network I/O
			// injected; state files in a temp dir) and PID-scoped watchdog
			// ownership. test-plan E3 E11-E13 P1 X4-X9.
			"src/lib/__tests__/runtime-overlay.test.ts",
			// Electron heap stamp (third launch path). Config read from a temp file;
			// only `launchDashboardServer` is module-mocked, no Electron runtime.
			// See change: guard-server-heap-and-store-coupling (E7 E8 E10 X5).
			"src/lib/__tests__/launch-source-heap.test.ts",
			"src/lib/__tests__/server-watchdog.test.ts",
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
