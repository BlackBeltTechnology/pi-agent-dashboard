/**
 * Test environment for the template start paths: the full UI env (runtime + REST app) over real temp
 * dirs — a project cwd (`<cwd>/.pi/teams`), a pi agent dir (user templates and agents), an injectable
 * project-trust flag and the known-folder list the REST cwd admission reads. Sessions are created on demand
 * (each start makes its caller the lead, so a test needing several teams uses several sessions).
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { createUiEnv, type UiEnvOptions } from "../../__tests__/harness/ui-env.js";
import type { Team } from "../../shared/types.js";
import { API_PREFIX } from "../routes.js";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

export interface RestAnswer {
  status: number;
  body: Record<string, any>;
  headers: Record<string, unknown>;
  raw: string;
}

export interface StartEnvOptions extends UiEnvOptions {
  /** Project trust: `true`/`false` ⇒ the host service answers; `undefined` ⇒ the service is absent. Default `true`. */
  trusted?: boolean | undefined;
  /** Extra known folders besides the project cwd. */
  known?: string[];
  dataDir?: string;
}

export async function createStartEnv(over: StartEnvOptions = {}) {
  const { trusted = true, known = [], ...rest } = over;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-start-")));
  made.push(root);
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "pi-agent");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  const state = { trusted: trusted as boolean | undefined, known: [cwd, ...known] };
  const e = await createUiEnv({
    ...rest,
    config: { maxActiveTeams: 50, ...(rest.config ?? {}) },
    runtime: {
      // The shipped bundled templates would appear in every listing: suites about plain templates start without the OpenSpec module.
      openspec: false,
      ...(rest.runtime ?? {}),
      templatesHost: {
        isProjectTrusted: (c: string) => state.trusted === true && c.length > 0,
        knownFolderCwds: () => state.known,
        resolvePiAgentDir: () => agentDir,
        ...(rest.runtime?.templatesHost ?? {}),
      },
    },
  });

  const dir = (source: "project" | "user", kind: "teams" | "agents"): string => (source === "project" ? path.join(cwd, ".pi", kind) : path.join(agentDir, kind));
  const write = (kind: "teams" | "agents") => (source: "project" | "user", stem: string, text: string): string => {
    fs.mkdirSync(dir(source, kind), { recursive: true });
    const p = path.join(dir(source, kind), `${stem}.md`);
    fs.writeFileSync(p, text);
    return p;
  };
  let n = 0;

  const inject = async (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<RestAnswer> => {
    const res = await e.app.inject({ method, url: url.startsWith("/api/") ? url : `${API_PREFIX}${url}`, headers, ...(payload !== undefined ? { payload: payload as never } : {}) });
    let body: Record<string, any> = {};
    try {
      body = res.body === "" ? {} : JSON.parse(res.body);
    } catch {
      body = { raw: res.body };
    }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.body };
  };

  return Object.assign(e, {
    cwd,
    agentDir,
    root,
    tpl: write("teams"),
    agent: write("agents"),
    dir,
    setTrusted(v: boolean | undefined) {
      state.trusted = v;
    },
    known: state.known,
    /** A fresh plain session rooted in the project (or `at`). */
    newSession(at = cwd, name = `S-plain-${++n}`): string {
      return e.fake.addSession(name, { cwd: at, principalOwner: "owner-p" });
    },
    /** `team.start` through the request lane as `session`. */
    start(args: Record<string, unknown>, session?: string) {
      return e.fake.call(session ?? this.newSession(), "team.start", args);
    },
    templates(session?: string) {
      return e.fake.call(session ?? this.newSession(), "team.templates", {});
    },
    /** REST helpers (JSON body; `x-principal` via `headers`). */
    restStart: (body: unknown, headers?: Record<string, string>) => inject("POST", "/teams/start", body, headers),
    rest: inject,
    /** Resolve a spawned lead session the way the host does and send its first `hello`. */
    async bindLead(team: Team, sid = `S-rest-lead-${++n}`): Promise<string> {
      e.fake.addSession(sid, { cwd: team.leadCwd, principalOwner: "owner-p" });
      e.fake.resolveSession(sid, { "agent-teams": { teamId: team.id, role: "lead" } });
      await e.fake.lane(sid, "agent-teams/hello", { isIdle: true, toolsActive: true, guardActive: true, confined: false });
      return sid;
    },
    /** Let the async start phase (microtasks + a macrotask) finish. */
    async flush(): Promise<void> {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    },
  });
}

export type StartEnv = Awaited<ReturnType<typeof createStartEnv>>;
