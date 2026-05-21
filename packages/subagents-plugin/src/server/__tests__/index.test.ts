/**
 * Plugin server entry tests — startup reconcile + onResponse hook behaviour.
 * Mocks the ServerPluginContext just enough to drive the two code paths.
 * See change: add-subagent-inspector §16.2.3.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Fastify from "fastify";
import registerPlugin from "../index.js";
import { producerFilePath } from "../producer-file.js";

interface MockReply {
	statusCode: number;
}
interface MockRequest {
	method: string;
	url: string;
}
type HookCb = (req: MockRequest, reply: MockReply, done: () => void) => void;

function makeMockCtx(initialConfig: Record<string, unknown>): {
	ctx: Parameters<typeof registerPlugin>[0];
	hooks: HookCb[];
	updates: Record<string, unknown>[];
	currentConfig: { value: Record<string, unknown> };
} {
	const hooks: HookCb[] = [];
	const updates: Record<string, unknown>[] = [];
	const currentConfig = { value: { ...initialConfig } };

	const ctx = {
		fastify: {
			addHook: (name: string, cb: HookCb) => {
				if (name === "onResponse") hooks.push(cb);
			},
		},
		getPluginConfig: <T = Record<string, unknown>>() => currentConfig.value as T,
		updatePluginConfig: async <T = Record<string, unknown>>(partial: Partial<T>) => {
			currentConfig.value = { ...currentConfig.value, ...(partial as Record<string, unknown>) };
			updates.push(partial as Record<string, unknown>);
		},
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		// Unused by this plugin but required by the type. Cast through unknown.
	} as unknown as Parameters<typeof registerPlugin>[0];

	return { ctx, hooks, updates, currentConfig };
}

describe("subagents-plugin server entry", () => {
	let originalHome: string | undefined;
	let tmpHome: string;

	beforeEach(() => {
		originalHome = process.env.HOME;
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-plugin-server-test-"));
		process.env.HOME = tmpHome;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("startup reconcile: copies producer.inheritContext to plugin config", async () => {
		const producerFile = producerFilePath();
		fs.mkdirSync(path.dirname(producerFile), { recursive: true });
		fs.writeFileSync(producerFile, JSON.stringify({ inheritContext: false }));

		const { ctx, updates } = makeMockCtx({ inheritContext: true });
		await registerPlugin(ctx);

		expect(updates).toEqual([{ inheritContext: false }]);
	});

	it("startup reconcile: skips when producer file is missing", async () => {
		const { ctx, updates } = makeMockCtx({ inheritContext: true });
		await registerPlugin(ctx);
		expect(updates).toEqual([]);
	});

	it("startup reconcile: skips when producer file has no inheritContext", async () => {
		const producerFile = producerFilePath();
		fs.mkdirSync(path.dirname(producerFile), { recursive: true });
		fs.writeFileSync(producerFile, JSON.stringify({ inheritance: { recentTurns: 5 } }));

		const { ctx, updates } = makeMockCtx({ inheritContext: true });
		await registerPlugin(ctx);
		expect(updates).toEqual([]);
	});

	it("onResponse hook: writes producer file on POST /api/config/plugins/subagents 200", async () => {
		const { ctx, hooks } = makeMockCtx({ inheritContext: false });
		await registerPlugin(ctx);
		expect(hooks.length).toBe(1);

		const done = vi.fn();
		hooks[0](
			{ method: "POST", url: "/api/config/plugins/subagents" },
			{ statusCode: 200 },
			done,
		);
		expect(done).toHaveBeenCalled();

		const written = JSON.parse(fs.readFileSync(producerFilePath(), "utf-8"));
		expect(written.inheritContext).toBe(false);
	});

	it("onResponse hook: preserves unexposed keys in producer file", async () => {
		// Seed the producer file with extra keys
		const producerFile = producerFilePath();
		fs.mkdirSync(path.dirname(producerFile), { recursive: true });
		fs.writeFileSync(
			producerFile,
			JSON.stringify({
				inheritContext: true,
				exposeInheritanceInTool: true,
				inheritance: { recentTurns: 10, toolOutputWindow: 3, maxChars: 30000 },
				customUserKey: "keep-me",
			}),
		);

		const { ctx, hooks, currentConfig } = makeMockCtx({ inheritContext: true });
		await registerPlugin(ctx);

		// Simulate the client toggling off → POST handler updated plugin config
		currentConfig.value = { inheritContext: false };

		hooks[0](
			{ method: "POST", url: "/api/config/plugins/subagents" },
			{ statusCode: 200 },
			() => undefined,
		);

		const written = JSON.parse(fs.readFileSync(producerFile, "utf-8"));
		expect(written.inheritContext).toBe(false);
		expect(written.exposeInheritanceInTool).toBe(true);
		expect(written.inheritance).toEqual({ recentTurns: 10, toolOutputWindow: 3, maxChars: 30000 });
		expect(written.customUserKey).toBe("keep-me");
	});

	it("onResponse hook: is a no-op for non-200 status", async () => {
		const { ctx, hooks } = makeMockCtx({ inheritContext: false });
		await registerPlugin(ctx);

		hooks[0](
			{ method: "POST", url: "/api/config/plugins/subagents" },
			{ statusCode: 400 },
			() => undefined,
		);

		expect(fs.existsSync(producerFilePath())).toBe(false);
	});

	it("onResponse hook: is a no-op for unrelated URLs", async () => {
		const { ctx, hooks } = makeMockCtx({ inheritContext: false });
		await registerPlugin(ctx);

		hooks[0](
			{ method: "POST", url: "/api/config/plugins/other-plugin" },
			{ statusCode: 200 },
			() => undefined,
		);

		expect(fs.existsSync(producerFilePath())).toBe(false);
	});

	it("onResponse hook: is a no-op for non-POST methods", async () => {
		const { ctx, hooks } = makeMockCtx({ inheritContext: false });
		await registerPlugin(ctx);

		hooks[0](
			{ method: "GET", url: "/api/config/plugins/subagents" },
			{ statusCode: 200 },
			() => undefined,
		);

		expect(fs.existsSync(producerFilePath())).toBe(false);
	});
});
