// Worker process for the multi-process lease tests (run via `node --import tsx`).
// argv: <role: sync|hang> <cwd> <baseDir> <logFile> <leaseSeconds>
import { appendFileSync } from "node:fs";
import type { ForgeAdapter } from "../../git-scope/forge/types.js";
import { GitScope } from "../../git-scope/scope.js";

const [role, cwd, baseDir, logFile, leaseSeconds] = process.argv.slice(2);
const never = new Promise<never>(() => {});
const forge: ForgeAdapter = {
  id: "github",
  endpoints: ["issues"],
  sharedNumberSpace: true,
  async list() {
    appendFileSync(logFile, `list ${process.pid} ${role}\n`);
    if (role === "hang") return never; // a hung owner: never heartbeats again
    await new Promise((r) => setTimeout(r, 1000));
    return { status: "ok", items: [], full: false, etag: null, rate: null };
  },
  async comments() {
    return { status: "ok", comments: [], etag: null, rate: null };
  },
};
const scope = new GitScope({ baseDir, adapterFor: () => forge, log: () => {}, gitConfig: { searchWaitMs: 300, forge: { leaseSeconds: Number(leaseSeconds) } } });
const t0 = Date.now();
const r = await scope.search({ query: "initial" }, { cwd });
process.stdout.write(`${JSON.stringify({ pid: process.pid, ms: Date.now() - t0, text: r.text })}\n`);
if (role === "hang") await never;
await scope.idle();
process.exit(0);
