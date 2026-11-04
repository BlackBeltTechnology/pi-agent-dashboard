/**
 * L2 probe for scope-pids-to-namespace: runs the REAL force-kill / shutdown
 * handlers and the REAL terminator against REAL OS processes and REAL platform
 * primitives (`killProcess`, `signalZero`, `buildPidNamespace`). Only the
 * session record and the gateway are stand-ins, so what is proven is the kill
 * decision against a live process table — the property that matters.
 *
 * Input (env): QA_CASES = JSON array of
 *   { name, pid, action: "force_kill" | "shutdown" | "terminate-unattended",
 *     cwd?, originDeviceId?, pidNamespace?: object | "self" }
 * ("self" = this process's real `buildPidNamespace()` output, i.e. a host target).
 * Output: one JSON line per case: { name, action, success?, message?, outcome?,
 *   orphanedPid?, alive } — `alive` is measured with a real `signalZero` after the action.
 *
 * Driven by qa/tests/54-pid-target.sh and qa/tests/54-windows-pid-target.ps1.
 */
import { forceKillSession, shutdownSession } from "../../../packages/server/src/browser-handlers/session-action-handler.ts";
import { createSessionTerminator } from "../../../packages/server/src/spawn-process/session-terminator.ts";
import { buildPidNamespace } from "../../../packages/shared/src/pid-namespace.ts";
import { signalZero } from "../../../packages/shared/src/platform/process.ts";

interface Case {
  name: string;
  pid: number;
  action: "force_kill" | "shutdown" | "terminate-unattended";
  cwd?: string;
  originDeviceId?: string;
  pidNamespace?: Record<string, unknown> | "self";
}

const cases: Case[] = JSON.parse(process.env.QA_CASES ?? "[]");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const c of cases) {
  let record: Record<string, unknown> | undefined = {
    id: c.name,
    cwd: c.cwd ?? process.cwd(),
    status: "active",
    source: "tui",
    pid: c.pid,
    pidRecordedAt: Date.now(),
    ...(c.originDeviceId ? { originDeviceId: c.originDeviceId } : {}),
    ...(c.pidNamespace ? { pidNamespace: c.pidNamespace === "self" ? buildPidNamespace() : c.pidNamespace } : {}),
  };
  const broadcasts: Array<{ type: string; pid?: number }> = [];
  const sessionManager = {
    get: () => record,
    update: (_id: string, u: Record<string, unknown>) => {
      if (record) record = { ...record, ...u };
    },
    unregister: () => {
      record = undefined;
    },
  };
  const deps = {
    sessionManager,
    piGateway: { closeSession: () => true, sendToSession: () => true },
    headlessPidRegistry: { getPid: () => undefined, killBySessionId: async () => false },
    broadcast: (m: { type: string; pid?: number }) => broadcasts.push(m),
  } as never;

  const out: Record<string, unknown> = { name: c.name, action: c.action };
  if (c.action === "force_kill") {
    const r = await forceKillSession(c.name, deps);
    Object.assign(out, { success: r.success, message: r.message });
  } else if (c.action === "shutdown") {
    await shutdownSession(c.name, deps);
    out.orphanedPid = broadcasts.find((b) => b.type === "session_orphaned")?.pid;
  } else {
    const { terminate } = createSessionTerminator({
      sessionManager: sessionManager as never,
      headlessPidRegistry: { getPid: () => undefined, killBySessionId: async () => false },
      warn: () => {},
    });
    out.outcome = (await terminate(c.name, { graceMs: 0, verifyIdentity: true, stampManualClose: true })).outcome;
  }
  // Give a signalled process up to 5 s to leave the process table.
  let alive = signalZero(c.pid) !== "esrch";
  for (let i = 0; alive && i < 50 && (out.success === true || out.outcome === "confirmed-dead"); i++) {
    await sleep(100);
    alive = signalZero(c.pid) !== "esrch";
  }
  out.alive = alive;
  console.log(JSON.stringify(out));
}
process.exit(0);
