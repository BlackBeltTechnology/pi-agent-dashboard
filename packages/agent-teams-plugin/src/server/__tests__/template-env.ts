/**
 * Test environment for template / agent discovery: a real temp cwd + pi agent dir, an injectable
 * trust flag, the real config reader and a mode registry holding only `session`.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { createConfigReader, type TeamsConfig } from "../config.js";
import type { MemberDriver } from "../driver.js";
import { createModeRegistry } from "../modes.js";
import type { TemplateDeps } from "../templates.js";
import type { Logger } from "../types.js";

export interface TemplateEnv {
  cwd: string;
  agentDir: string;
  deps: TemplateDeps;
  logs: { warn: string[]; error: string[] };
  /** `true`/`false` ⇒ the host service answers; `undefined` ⇒ the service is absent (fail closed). */
  setTrusted(v: boolean | undefined): void;
  setConfig(patch: Record<string, unknown>): void;
  /** Write `<cwd>/.pi/teams/<stem>.md` (project) or `<agentDir>/teams/<stem>.md` (user); returns the path. */
  tpl(source: "project" | "user", stem: string, text: string): string;
  agent(source: "project" | "user", stem: string, text: string): string;
  dir(source: "project" | "user", kind: "teams" | "agents"): string;
}

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** `---\n<yaml lines>\n---\n<body>` from a frontmatter object written as JSON (valid YAML). */
export function md(front: Record<string, unknown>, body = "Lead playbook."): string {
  return `---\n${Object.entries(front)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n${body}\n`;
}

export function createTemplateEnv(): TemplateEnv {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-tpl-")));
  made.push(root);
  const cwd = path.join(root, "project");
  const agentDir = path.join(root, "pi-agent");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  const logs = { warn: [] as string[], error: [] as string[] };
  const logger: Logger = { info() {}, warn: (m: string) => void logs.warn.push(m), error: (m: string) => void logs.error.push(m) };
  let rawConfig: Record<string, unknown> = {};
  const config = createConfigReader(() => rawConfig, logger);
  const host = {
    isProjectTrusted: (() => true) as (cwd: string) => boolean,
    knownFolderCwds: () => [],
    resolvePiAgentDir: () => agentDir,
    onShutdown: () => () => {},
  };
  const dir = (source: "project" | "user", kind: "teams" | "agents"): string => (source === "project" ? path.join(cwd, ".pi", kind) : path.join(agentDir, kind));
  const write = (kind: "teams" | "agents") => (source: "project" | "user", stem: string, text: string): string => {
    const d = dir(source, kind);
    fs.mkdirSync(d, { recursive: true });
    const p = path.join(d, `${stem}.md`);
    fs.writeFileSync(p, text);
    return p;
  };
  return {
    cwd,
    agentDir,
    logs,
    deps: { config: config as () => TeamsConfig, host, modes: createModeRegistry({ mode: "session" } as unknown as MemberDriver), logger },
    setTrusted: (v) => {
      host.isProjectTrusted = v === undefined ? (undefined as unknown as (cwd: string) => boolean) : () => v;
    },
    setConfig: (patch) => {
      rawConfig = { ...rawConfig, ...patch };
    },
    tpl: write("teams"),
    agent: write("agents"),
    dir,
  };
}
