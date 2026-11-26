/**
 * Server epoch (test-plan S53, L1 half): random per start, constant within one,
 * and an ETag from a previous start never answers 304. The L2 half is
 * `qa/tests/60-agent-teams-ui-restart.sh`.
 * See change: add-agent-teams-ui.
 */
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTeamsEnv } from "../../__tests__/harness/index.js";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";
import { mintEpoch } from "../epoch.js";
import { API_PREFIX, mountTeamsRoutes } from "../routes.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});

describe("mintEpoch (S53)", () => {
  it("is random, non-sequential and ETag-safe", () => {
    const epochs = Array.from({ length: 200 }, () => mintEpoch());
    expect(new Set(epochs).size).toBe(200);
    for (const e of epochs) expect(e).toMatch(/^[0-9a-f]{16}$/);
    const nums = epochs.map((e) => Number.parseInt(e.slice(0, 8), 16));
    expect(nums.filter((n, i) => i > 0 && n === (nums[i - 1] as number) + 1)).toEqual([]);
  });
});

describe("epoch across starts (S53)", () => {
  it("constant within a start; differs across starts; an ETag of the previous start is a 200, not a 304", async () => {
    const first = await createUiEnv({ epoch: mintEpoch() });
    envs.push(first);
    const team = await first.createTeam();
    const url = `/teams/${team.id}`;
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) seen.add((await first.get<TeamUiSnapshot>(url)).body.epoch);
    expect(seen.size).toBe(1);
    const oldEtag = (await first.get(url)).headers.etag as string;
    first.fake.runShutdownHooks();

    const second = await createUiEnv({ epoch: mintEpoch(), dataDir: first.fake.dataDir });
    envs.push(second);
    const revived = second.rt.store.get(team.id);
    expect(revived).toBeDefined();
    const res = await second.get<TeamUiSnapshot>(url, { "if-none-match": oldEtag });
    expect(res.status).toBe(200);
    expect(res.body.epoch).not.toBe([...seen][0]);
    expect(res.headers.etag).not.toBe(oldEtag);
  });

  it("without an injected epoch the routes use one per-process epoch (the production default is minted by registerPlugin)", async () => {
    const e = createTeamsEnv();
    const mount = async () => {
      const app = Fastify();
      await mountTeamsRoutes(app, { store: e.rt.store, telemetry: e.rt.telemetry, ext: e.rt.ext, logger: e.fake.host.logger });
      await app.ready();
      const team = await e.createTeam().catch(() => e.rt.store.list()[0]);
      const res = await app.inject({ method: "GET", url: `${API_PREFIX}/teams/${team?.id}` });
      await app.close();
      return (res.json() as TeamUiSnapshot).epoch;
    };
    const a = await mount();
    const b = await mount();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });
});
