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
type RouteHandler = (req: { body?: unknown }, reply: RouteReply) => Promise<unknown>;

/** Minimal Fastify reply capturing status + payload. */
class RouteReply {
	statusCode = 200;
	payload: unknown;
	code(n: number) {
		this.statusCode = n;
		return this;
	}
	send(p: unknown) {
		this.payload = p;
		return this;
	}
}

interface MockOpts {
	/** `undefined` = the identity seam is absent. */
	operate?: boolean;
	sessions?: string[];
	emitResult?: boolean;
}

function makeMockCtx(initialConfig: Record<string, unknown>, opts: MockOpts = {}): {
	ctx: Parameters<typeof registerPlugin>[0];
	hooks: HookCb[];
	updates: Record<string, unknown>[];
	currentConfig: { value: Record<string, unknown> };
	routes: Map<string, RouteHandler>;
	emit: ReturnType<typeof vi.fn>;
	logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
	const hooks: HookCb[] = [];
	const updates: Record<string, unknown>[] = [];
	const currentConfig = { value: { ...initialConfig } };
	const routes = new Map<string, RouteHandler>();
	const emit = vi.fn(() => opts.emitResult ?? true);
	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
	const sessions = new Set(opts.sessions ?? ["sess-1"]);

	const ctx = {
		fastify: {
			addHook: (name: string, cb: HookCb) => {
				if (name === "onResponse") hooks.push(cb);
			},
			post: (url: string, _o: unknown, h: RouteHandler) => routes.set(`POST ${url}`, h),
			get: (url: string, _o: unknown, h: RouteHandler) => routes.set(`GET ${url}`, h),
		},
		networkGuard: async () => {},
		identity: opts.operate === undefined ? undefined : { hasOperateAuthority: () => opts.operate },
		sessionManager: { getSession: (id: string) => (sessions.has(id) ? { id } : undefined) },
		emitEventToSession: emit,
		getPluginConfig: <T = Record<string, unknown>>() => currentConfig.value as T,
		updatePluginConfig: async <T = Record<string, unknown>>(partial: Partial<T>) => {
			currentConfig.value = { ...currentConfig.value, ...(partial as Record<string, unknown>) };
			updates.push(partial as Record<string, unknown>);
		},
		logger,
		// Unused by this plugin but required by the type. Cast through unknown.
	} as unknown as Parameters<typeof registerPlugin>[0];

	return { ctx, hooks, updates, currentConfig, routes, emit, logger };
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

	// ── maxConcurrent mirror (change: subagent-queue-visibility, D5) ─────────────

	function seedProducer(content: Record<string, unknown>) {
		const f = producerFilePath();
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, JSON.stringify(content));
		return f;
	}
	const fireSave = (hooks: HookCb[]) =>
		hooks[0]({ method: "POST", url: "/api/config/plugins/subagents" }, { statusCode: 200 }, () => undefined);

	// test-plan #E13 — startup reconcile clamps, never rewrites the file.
	it.each([
		[6, 6],
		[100, 64],
		[undefined, undefined],
		["x", undefined],
	])("#E13 reconcile file maxConcurrent=%s → plugin config %s, file untouched", async (fileValue, expected) => {
		const f = seedProducer(fileValue === undefined ? { inheritContext: true } : { inheritContext: true, maxConcurrent: fileValue });
		const before = fs.readFileSync(f, "utf-8");
		const { ctx, currentConfig } = makeMockCtx({ inheritContext: true });
		await registerPlugin(ctx);
		expect(currentConfig.value.maxConcurrent).toBe(expected);
		expect(fs.readFileSync(f, "utf-8")).toBe(before);
	});

	// test-plan #E14 — an unrelated save keeps a hand-set limit.
	it("#E14 saving only inheritContext keeps a hand-set maxConcurrent:100", async () => {
		const f = seedProducer({ inheritContext: true, maxConcurrent: 100 });
		const { ctx, hooks, currentConfig } = makeMockCtx({ inheritContext: true });
		await registerPlugin(ctx); // reconcile shows 64
		currentConfig.value = { ...currentConfig.value, inheritContext: false };
		fireSave(hooks);
		const written = JSON.parse(fs.readFileSync(f, "utf-8"));
		expect(written.inheritContext).toBe(false);
		expect(written.maxConcurrent).toBe(100);
	});

	it("#E14 no explicit plugin value → maxConcurrent is not written", async () => {
		const f = seedProducer({ inheritContext: true });
		const { ctx, hooks } = makeMockCtx({ inheritContext: false });
		await registerPlugin(ctx);
		fireSave(hooks);
		expect("maxConcurrent" in JSON.parse(fs.readFileSync(f, "utf-8"))).toBe(false);
	});

	it("an explicit changed limit is mirrored", async () => {
		const f = seedProducer({ inheritContext: true, maxConcurrent: 4, custom: "keep" });
		const { ctx, hooks, currentConfig } = makeMockCtx({});
		await registerPlugin(ctx);
		currentConfig.value = { inheritContext: true, maxConcurrent: 8 };
		fireSave(hooks);
		expect(JSON.parse(fs.readFileSync(f, "utf-8"))).toEqual({ inheritContext: true, maxConcurrent: 8, custom: "keep" });
	});

	// ── stop route (change: subagent-queue-visibility, D3) ───────────────────────

	async function post(opts: MockOpts, body: unknown) {
		const m = makeMockCtx({}, opts);
		await registerPlugin(m.ctx);
		const reply = new RouteReply();
		await m.routes.get("POST /api/plugins/subagents/stop")!({ body }, reply);
		return { reply, ...m };
	}

	// test-plan #E8 — validation, authority and session scoping.
	it.each([
		["", 400],
		["a".repeat(128), 200],
		["a".repeat(129), 400],
		["a\u0000b", 400],
		["a\u0085b", 400],
		["ag-1", 200],
	])("#E8 agentId %j → %i", async (agentId, status) => {
		const { reply, emit } = await post({ operate: true }, { sessionId: "sess-1", agentId });
		expect(reply.statusCode).toBe(status);
		expect(emit).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
	});

	it("#E8 non-string / missing ids → 400, no emit", async () => {
		for (const body of [{ sessionId: "sess-1" }, { sessionId: 1, agentId: "a" }, null]) {
			const { reply, emit } = await post({ operate: true }, body);
			expect(reply.statusCode).toBe(400);
			expect(emit).not.toHaveBeenCalled();
		}
	});

	it("#E8 unknown session → 404, no emit", async () => {
		const { reply, emit } = await post({ operate: true }, { sessionId: "nope", agentId: "ag-1" });
		expect(reply.statusCode).toBe(404);
		expect(emit).not.toHaveBeenCalled();
	});

	it.each([
		["no authority", false],
		["seam absent", undefined],
	])("#E8 %s → 403, no emit", async (_label, operate) => {
		const { reply, emit } = await post({ operate }, { sessionId: "sess-1", agentId: "ag-1" });
		expect(reply.statusCode).toBe(403);
		expect(emit).not.toHaveBeenCalled();
	});

	// test-plan #E9 / #X7 — fixed relay; seam refusal → 503.
	it("#E9 relays exactly subagents:stop {agentId}, ignoring extra body keys", async () => {
		const { reply, emit, logger } = await post(
			{ operate: true },
			{ sessionId: "sess-1", agentId: "ag-1", eventType: "x", data: { evil: true } },
		);
		expect(reply.statusCode).toBe(200);
		expect(emit).toHaveBeenCalledWith("sess-1", "subagents:stop", { agentId: "ag-1" });
		expect(logger.info.mock.calls.some(([m]) => /session=sess-1 agent=ag-1 outcome=requested/.test(String(m)))).toBe(true);
	});

	it("#X7 emit seam refuses → 503", async () => {
		const { reply } = await post({ operate: true, emitResult: false }, { sessionId: "sess-1", agentId: "ag-1" });
		expect(reply.statusCode).toBe(503);
		expect((reply.payload as { error: string }).error).toMatch(/not reachable/);
	});

	// design D5 — limits route.
	it("GET limits returns the session heap ceiling", async () => {
		const m = makeMockCtx({});
		await registerPlugin(m.ctx);
		const body = (await m.routes.get("GET /api/plugins/subagents/limits")!({}, new RouteReply())) as { heapCeilingMb: unknown };
		expect(typeof body.heapCeilingMb).toBe("number");
	});
});
