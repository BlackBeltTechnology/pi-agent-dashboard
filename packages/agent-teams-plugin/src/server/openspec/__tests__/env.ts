/**
 * Shared test environment of the OpenSpec foundation: the full start env (runtime + REST app over temp
 * dirs) with fixture templates in a temporary `templates/` directory, the module handle (`api`) and helpers
 * to register a fake profile kind and to create a bundled-profile team directly.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { OpenspecProfileKind } from "../../../shared/openspec-profile.js";
import type { Team } from "../../../shared/types.js";
import { createStartEnv, type StartEnv, type StartEnvOptions } from "../../__tests__/start-env.js";
import { md } from "../../__tests__/template-env.js";
import type { OpenspecInitOptions } from "../index.js";
import type { OpenspecApi, OpenspecKindImpl } from "../profiles.js";
import type { SeedPlan } from "../seed-core.js";

export const APPLY = "openspec-apply";
export const GROUP = "openspec-group";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

export const tmp = (prefix = "at-os-"): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(d);
  return d;
};

/** A valid bundled fixture template (mode session, no TaskCreated hook). */
export const fixtureTemplate = (name: string, extra: Record<string, unknown> = {}): string => md({ name, description: `fixture ${name}`, mode: "session", spawn: "lead", ...extra }, "Fixture playbook.");

export interface OpenspecEnvOptions extends StartEnvOptions {
  /** Bundled fixture templates to write (default: both). */
  templates?: string[];
  openspec?: OpenspecInitOptions;
}

export type OpenspecEnv = StartEnv & {
  api: OpenspecApi;
  templatesDir: string;
  dataDir: string;
  /** Register a fake implementation of a kind; returns its disposer. */
  kind(kind: OpenspecProfileKind, impl: Partial<OpenspecKindImpl> & { plan?: OpenspecKindImpl["plan"] }): () => void;
  /** A live team started from the bundled template `kind` (no seeding), goal `goal`. */
  team(kind: OpenspecProfileKind, goal?: string, over?: { seeded?: boolean; source?: "bundled" | "user" | "project" }): Team;
};

export async function createOpenspecEnv(over: OpenspecEnvOptions = {}): Promise<OpenspecEnv> {
  const { templates = [APPLY, GROUP], openspec = {}, runtime, ...rest } = over;
  const templatesDir = tmp("at-os-tpl-");
  for (const name of templates) fs.writeFileSync(path.join(templatesDir, `${name}.md`), fixtureTemplate(name));
  const e = await createStartEnv({ ...rest, runtime: { ...(runtime ?? {}), ...(runtime?.openspec === false ? {} : { openspec: { templatesDir, ...openspec } }) } });
  const api = e.rt.openspec as OpenspecApi;
  return Object.assign(e, {
    api,
    templatesDir,
    dataDir: e.fake.dataDir,
    kind(kind: OpenspecProfileKind, impl: Partial<OpenspecKindImpl>) {
      const full: OpenspecKindImpl = { plan: (): SeedPlan => ({ tasks: [] }), ...impl } as OpenspecKindImpl;
      return api.registerOpenspecProfile(kind, full);
    },
    team(kind: OpenspecProfileKind, goal = "x", o: { seeded?: boolean; source?: "bundled" | "user" | "project" } = {}): Team {
      const res = e.rt.ops.createTeam({
        name: `openspec-${kind}`,
        leadCwd: e.cwd,
        leadSessionId: e.fake.addSession(`S-lead-${Math.random().toString(36).slice(2, 8)}`, { cwd: e.cwd }),
        template: { name: `openspec-${kind}`, source: o.source ?? "bundled", hash: "h", goal, playbook: "p", members: [], spawn: "lead", ...(o.seeded ? { seeded: true } : {}) },
      });
      if (!res.ok) throw new Error(`createTeam failed: ${res.error}`);
      return res.data;
    },
  }) as OpenspecEnv;
}

/** Seed tasks named by key; `deps` = keys they wait for. */
export const tasksOf = (spec: Array<[key: string, deps?: string[]]>): SeedPlan["tasks"] => spec.map(([key, deps]) => ({ key, title: `Task ${key}`, ...(deps ? { blockedBy: deps } : {}) }));
