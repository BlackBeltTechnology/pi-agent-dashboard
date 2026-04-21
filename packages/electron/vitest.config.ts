import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/__tests__/**/*.test.ts"],
		environment: "node",
		pool: "forks",
		maxWorkers: 1,
		globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
	},
});
