import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeAdapterFromEnv, FakeAdapter } from "../fake.js";

/**
 * The harness fixture. Its own unit tests matter because the L3 specs assert on
 * what it produces: a fixture whose delegation answer disagreed with the real
 * `assignersForRole` rule would make F1/F2 prove nothing about the shipped rule.
 */
const dirs: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-fake-"));
	dirs.push(dir);
	return dir;
}

function outbound(dir: string): Array<Record<string, unknown>> {
	const raw = fs.readFileSync(path.join(dir, "outbound.jsonl"), "utf8");
	return raw
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

afterEach(() => {
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

describe("FakeAdapter delegation", () => {
	it("lists the owner AND a non-owner assigner, and never the bystander", async () => {
		const adapter = new FakeAdapter({ dir: tempDir(), mode: "list" });
		const answers = await adapter.assignersForRoles("g1", ["e2e_role_1"]);
		const answer = answers.e2e_role_1;
		expect(answer?.kind).toBe("assigners");
		if (answer?.kind !== "assigners") throw new Error("unreachable");
		const ids = answer.members.map((m) => m.id).sort();
		// The owner qualifies by ownership; the delegator by Manage Roles + a
		// higher position. The bystander has neither and would make the
		// assertion vacuous if it appeared.
		expect(ids).toEqual(["e2e_delegator", "e2e_owner"]);
	});

	it("reports unavailability with a NAMED permission, never an empty roster", async () => {
		const adapter = new FakeAdapter({ dir: tempDir(), mode: "nolist" });
		const answers = await adapter.assignersForRoles("g1", ["r1", "r2"]);
		// Every asked role gets an answer — a missing key would be read as an
		// empty roster by the caller, which is the failure F2 exists to catch.
		expect(Object.keys(answers).sort()).toEqual(["r1", "r2"]);
		for (const roleId of ["r1", "r2"]) {
			const answer = answers[roleId];
			expect(answer?.kind).toBe("unavailable");
			if (answer?.kind !== "unavailable") throw new Error("unreachable");
			expect(answer.missingPermission.length).toBeGreaterThan(0);
		}
	});
});

describe("FakeAdapter platform calls", () => {
	it("records sends with the channel and content a spec filters on", async () => {
		const dir = tempDir();
		const adapter = new FakeAdapter({ dir, mode: "list" });
		await adapter.initialize();
		await adapter.sendMessage("chan-1", "hello");
		const sent = outbound(dir).filter((r) => r.kind === "send");
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ channelId: "chan-1", content: "hello" });
	});

	it("returns the SAME channelId it recorded for a provision", async () => {
		const dir = tempDir();
		const adapter = new FakeAdapter({ dir, mode: "list" });
		await adapter.initialize();
		const { channelId } = await adapter.provisionChannel({
			guildId: "g1",
			name: "ws-name",
			overwrites: [{ targetId: "g1", kind: "role", viewChannel: false }],
		});
		const recorded = outbound(dir).find((r) => r.kind === "provision");
		// A spec resolves the provisioned channel BY ID, so a mismatch here
		// would silently break every provisioning assertion.
		expect(recorded?.channelId).toBe(channelId);
	});

	it("truncates both scratch files on initialize so a spec starts empty", async () => {
		const dir = tempDir();
		await new FakeAdapter({ dir, mode: "list" }).initialize();
		await new FakeAdapter({ dir, mode: "list" }).sendMessage("old", "stale");
		await new FakeAdapter({ dir, mode: "list" }).initialize();
		expect(outbound(dir)).toEqual([]);
		expect(fs.readFileSync(path.join(dir, "inbound.jsonl"), "utf8")).toBe("");
	});
});

describe("FakeAdapter inbound injection", () => {
	it("emits an appended inbound line as a platform message", async () => {
		const dir = tempDir();
		const adapter = new FakeAdapter({ dir, mode: "list" });
		await adapter.initialize();
		const seen: Array<{ channelId: string; content: string; userId: string }> = [];
		await adapter.start({
			onMessage: async (m) => {
				seen.push({ channelId: m.channelId, content: m.content, userId: m.userId });
			},
		});
		fs.appendFileSync(
			path.join(dir, "inbound.jsonl"),
			`${JSON.stringify({ channelId: "c1", userId: "e2e_invoker", content: "do it" })}\n`,
		);
		await vi.waitFor(() => {
			expect(seen).toHaveLength(1);
		});
		expect(seen[0]).toEqual({ channelId: "c1", content: "do it", userId: "e2e_invoker" });
		await adapter.stop();
	});

	it("emits each line exactly once across drains", async () => {
		const dir = tempDir();
		const adapter = new FakeAdapter({ dir, mode: "list" });
		await adapter.initialize();
		const contents: string[] = [];
		await adapter.start({ onMessage: async (m) => void contents.push(m.content) });
		const line = (c: string) => `${JSON.stringify({ channelId: "c1", content: c })}\n`;
		fs.appendFileSync(path.join(dir, "inbound.jsonl"), line("first"));
		await vi.waitFor(() => expect(contents).toHaveLength(1));
		fs.appendFileSync(path.join(dir, "inbound.jsonl"), line("second"));
		await vi.waitFor(() => expect(contents).toHaveLength(2));
		// A re-drain of already-consumed lines would double-drive the gateway.
		await new Promise((r) => setTimeout(r, 150));
		expect(contents).toEqual(["first", "second"]);
		await adapter.stop();
	});

	it("ignores a malformed line instead of crashing the poll", async () => {
		const dir = tempDir();
		const adapter = new FakeAdapter({ dir, mode: "list" });
		await adapter.initialize();
		const contents: string[] = [];
		await adapter.start({ onMessage: async (m) => void contents.push(m.content) });
		const file = path.join(dir, "inbound.jsonl");
		fs.appendFileSync(file, "{ not json\n");
		fs.appendFileSync(file, `${JSON.stringify({ channelId: "c1", content: "ok" })}\n`);
		await vi.waitFor(() => expect(contents).toEqual(["ok"]));
		await adapter.stop();
	});
});

describe("createFakeAdapterFromEnv", () => {
	it("returns undefined when the guard is unset, so a real install cannot reach it", () => {
		vi.stubEnv("PI_CHAT_GATEWAY_FAKE", "");
		expect(createFakeAdapterFromEnv()).toBeUndefined();
	});

	it("builds a listing adapter for =1 and a nolist one for =nolist", async () => {
		vi.stubEnv("PI_CHAT_GATEWAY_FAKE", "1");
		vi.stubEnv("PI_CHAT_GATEWAY_FAKE_DIR", tempDir());
		const listing = createFakeAdapterFromEnv();
		const listed = await listing?.assignersForRoles("g1", ["r1"]);
		expect(listed?.r1.kind).toBe("assigners");

		vi.stubEnv("PI_CHAT_GATEWAY_FAKE", "nolist");
		vi.stubEnv("PI_CHAT_GATEWAY_FAKE_DIR", tempDir());
		const noList = createFakeAdapterFromEnv();
		const unavailable = await noList?.assignersForRoles("g1", ["r1"]);
		expect(unavailable?.r1.kind).toBe("unavailable");
	});
});
