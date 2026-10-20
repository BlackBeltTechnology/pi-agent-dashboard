/**
 * Shared test harness for the supervised gate: a controllable fake PromptBus
 * transport (a cancel resolves `{cancelled:true,source:"__bus__"}` exactly like
 * the real bus) plus a gate factory with injectable deps.
 */
import { DEFAULT_SUPERVISED_MODE, type SupervisedModeConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { vi } from "vitest";
import {
  createSupervisedGate,
  type SupervisedDecisionEntry,
  type SupervisedGateCtx,
  type SupervisedGateDeps,
  type SupervisedPromptRequest,
  type SupervisedPromptResult,
} from "../handler.js";

export function fakePrompter() {
  const reqs: SupervisedPromptRequest[] = [];
  const pending = new Map<string, (r: SupervisedPromptResult) => void>();
  const cancel = vi.fn((id: string) => {
    pending.get(id)?.({ cancelled: true, source: "__bus__" });
    pending.delete(id);
  });
  return {
    reqs,
    cancel,
    request: (req: SupervisedPromptRequest) =>
      new Promise<SupervisedPromptResult>((res) => {
        reqs.push(req);
        pending.set(req.id, res);
      }),
    /** Answer request #`index` (default: the last). */
    answer(answer: string | undefined, source = "dashboard-default", index = reqs.length - 1) {
      const id = reqs[index].id;
      pending.get(id)?.({ answer, source });
      pending.delete(id);
    },
    dismiss(index = reqs.length - 1) {
      const id = reqs[index].id;
      pending.get(id)?.({ cancelled: true, source: "dashboard-default" });
      pending.delete(id);
    },
    isPending: (index: number) => pending.has(reqs[index].id),
  };
}

export type Cfg = SupervisedModeConfig;

export function makeGate(
  o: {
    mode?: boolean | ((sid: string) => boolean);
    cfg?: Partial<Cfg>;
    busMs?: number;
    sid?: string | (() => string);
    handoff?: (sid: string, id: string) => boolean;
    owner?: (sid: string) => string | undefined;
    redact?: (s: string) => string;
    prompter?: ReturnType<typeof fakePrompter>;
    ids?: boolean;
  } = {},
) {
  const prompter = o.prompter ?? fakePrompter();
  const records: SupervisedDecisionEntry[] = [];
  const logs: string[] = [];
  let n = 0;
  const cfg: Cfg = { ...DEFAULT_SUPERVISED_MODE, tools: [...DEFAULT_SUPERVISED_MODE.tools], ...o.cfg };
  const deps: SupervisedGateDeps = {
    sessionId: typeof o.sid === "function" ? o.sid : () => (o.sid as string | undefined) ?? "S1",
    getMode: typeof o.mode === "function" ? o.mode : () => (o.mode as boolean | undefined) ?? true,
    getConfig: () => cfg,
    getBusTimeoutMs: () => o.busMs ?? 300_000,
    prompter,
    consumeHandoff: o.handoff,
    getOwner: o.owner ?? (() => undefined),
    redact: o.redact,
    record: (e) => records.push(e),
    log: (l) => logs.push(l),
    newId: () => `id${++n}`,
  };
  const gate = createSupervisedGate(deps);
  const ctx = (extra: Partial<SupervisedGateCtx> = {}): SupervisedGateCtx => ({ hasUI: true, cwd: "/w/repo", ...extra });
  const call = (toolName: string, input: unknown = { command: "echo hi" }, toolCallId = "tc1", c: Partial<SupervisedGateCtx> = {}) =>
    gate.handler({ toolName, toolCallId, input }, ctx(c));
  return { gate, prompter, records, logs, cfg, deps, call, ctx };
}

/** Flush the microtask queue (promise chains in the gate / mutex). */
export const flush = async (times = 30) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};
