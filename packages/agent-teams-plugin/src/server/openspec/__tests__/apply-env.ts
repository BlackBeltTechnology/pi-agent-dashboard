/**
 * Test environment of the `openspec-apply` slice: the OpenSpec env of the foundation plus
 *  - a change directory with a real `tasks.md` under the project cwd,
 *  - an in-process stand-in for the dashboard routes (`inject`) that runs the REAL parser/writer of
 *    `packages/server/src/openspec/openspec-tasks.ts` (so byte preservation, CRLF/BOM and the 409/404 rules are
 *    the real ones) with a per-call fault hook and a call log,
 *  - a skill resolver answering from a set.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InjectFn, InjectRequest, InjectResult } from "../inject.js";
import { createOpenspecEnv, type OpenspecEnv, type OpenspecEnvOptions } from "./env.js";
import { serverTasks } from "./server-src.js";

const { LineMismatchError, NotACheckboxError, NotFoundError, readTasks, toggleTask } = serverTasks;

export const TEMPLATES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../templates");

interface InjectCall {
  method: string;
  path: string;
  body?: unknown;
  status: number;
}

export type Fault = (req: InjectRequest, n: number) => InjectResult | undefined | Promise<InjectResult | undefined>;

export interface ApplyEnvOptions extends Omit<OpenspecEnvOptions, "openspec"> {
  change?: string;
  /** `tasks.md` of the change (not written when `undefined`). */
  tasksMd?: string | undefined;
  skills?: string[];
  /** Use the shipped `templates/` instead of the minimal fixture templates. */
  realTemplates?: boolean;
  openspec?: OpenspecEnvOptions["openspec"];
}

export type ApplyEnv = OpenspecEnv & {
  change: string;
  tasksFile: string;
  calls: InjectCall[];
  /** Faults are consulted in order per call; the first non-undefined answer wins. */
  faults: Fault[];
  skills: Set<string>;
  write(md: string): void;
  read(): string;
  writeChange(name: string, md?: string): string;
  tasksOf(): Array<{ id: string; done: boolean }>;
};

export const ok = (body: unknown = { success: true }, statusCode = 200): InjectResult => ({ statusCode, body });

/** The in-process dashboard routes for `tasks`/`toggle`, over the real server functions. */
function createFileInject(calls: InjectCall[], faults: Fault[]): InjectFn {
  let n = 0;
  return async (req) => {
    n++;
    const u = new URL(req.url, "http://localhost");
    let res: InjectResult | undefined;
    for (const f of faults) {
      res = await f(req, n);
      if (res) break;
    }
    res ??= await real(req, u);
    calls.push({ method: req.method, path: u.pathname, ...(req.payload !== undefined ? { body: req.payload } : {}), status: res.statusCode });
    return res;
  };
}

async function real(req: InjectRequest, u: URL): Promise<InjectResult> {
  try {
    if (req.method === "GET" && u.pathname === "/api/openspec/tasks") {
      const tasks = await readTasks(u.searchParams.get("cwd") as string, u.searchParams.get("change") as string);
      return ok({ success: true, data: { tasks, groups: [] } });
    }
    if (req.method === "POST" && u.pathname === "/api/openspec/tasks/toggle") {
      const b = req.payload as { cwd: string; change: string; id: string; done: boolean; line: number };
      const task = await toggleTask(b.cwd, b.change, b.id, b.done, b.line);
      return ok({ success: true, data: { task } });
    }
    return { statusCode: 404, body: { success: false } };
  } catch (err) {
    if (err instanceof NotFoundError) return { statusCode: 404, body: { success: false, error: "tasks.md not found" } };
    if (err instanceof LineMismatchError) return { statusCode: 409, body: { success: false, error: "line mismatch" } };
    if (err instanceof NotACheckboxError) return { statusCode: 400, body: { success: false } };
    return { statusCode: 500, body: { success: false, error: (err as Error).message } };
  }
}

export async function createApplyEnv(over: ApplyEnvOptions = {}): Promise<ApplyEnv> {
  const { change = "x", tasksMd, skills = ["review-code"], realTemplates = false, openspec, ...rest } = over;
  const calls: InjectCall[] = [];
  const faults: Fault[] = [];
  const skillSet = new Set(skills);
  const e = await createOpenspecEnv({
    ...rest,
    openspec: {
      inject: createFileInject(calls, faults),
      resolveSkill: async (name) => (skillSet.has(name) ? { ok: true } : { ok: false, error: "skill_not_found" }),
      ...(realTemplates ? { templatesDir: TEMPLATES_DIR } : {}),
      ...(openspec ?? {}),
    },
  });
  const writeChange = (name: string, md?: string): string => {
    const dir = path.join(e.cwd, "openspec", "changes", name);
    fs.mkdirSync(dir, { recursive: true });
    if (md !== undefined) fs.writeFileSync(path.join(dir, "tasks.md"), md);
    return dir;
  };
  e.fake.setPiResources({ local: { skills: [...skillSet].map((name) => ({ name, filePath: `/skills/${name}/SKILL.md`, type: "skill", enabled: true })) }, global: { skills: [] }, packages: [] });
  writeChange(change, tasksMd);
  const tasksFile = path.join(e.cwd, "openspec", "changes", change, "tasks.md");
  return Object.assign(e, {
    change,
    tasksFile,
    calls,
    faults,
    skills: skillSet,
    write: (md: string) => fs.writeFileSync(tasksFile, md),
    read: () => fs.readFileSync(tasksFile, "utf8"),
    writeChange,
    tasksOf: () => {
      const text = fs.readFileSync(tasksFile, "utf8");
      return text
        .split(/\r?\n/)
        .map((l) => /^- \[([ xX])\] (?:([0-9]+(?:\.[0-9]+)*) +)?/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ id: m[2] ?? "L", done: m[1] !== " " }));
    },
  }) as ApplyEnv;
}

/** A tasks.md with `n` unticked checkboxes spread over `sections` sections (ids `s.k`). */
export function wideTasks(n: number, sections: number): string {
  const out: string[] = [];
  const per = Math.ceil(n / sections);
  let left = n;
  for (let s = 1; s <= sections && left > 0; s++) {
    out.push(`## ${s}. Section ${s}`, "");
    for (let k = 1; k <= per && left > 0; k++, left--) out.push(`- [ ] ${s}.${k} Do ${s}.${k}`);
    out.push("");
  }
  return `${out.join("\n")}\n`;
}
