/**
 * A scripted in-process stand-in for the `Supervisor` (no child process): records every request, runs the
 * request's `stage` at "dequeue" like the real one, and answers from a function. Used where only the MCP
 * layer (argument validation, result encoding) is under test.
 *
 * See change: add-blender-wasm-mcp (design D9).
 */
import { ToolError } from "../../errors.js";
import type { Call, Cancelled, OpRequest, Outcome, OutcomeOk, Supervisor } from "../../host/supervisor.js";

export function okOutcome(over: Partial<OutcomeOk> = {}): OutcomeOk {
  return { ok: true, result: {}, files: {}, output: "", outputTruncated: false, sessionReset: false, durationMs: 1, ...over };
}

export type Responder = (req: OpRequest, index: number) => Outcome | Promise<Outcome>;

export class FakeSupervisor implements Pick<Supervisor, "enqueue" | "takeReset" | "shutdown"> {
  readonly requests: OpRequest[] = [];
  shutdownCalls = 0;
  private reset = false;

  private readonly respond: Responder;

  constructor(respond: Responder = () => okOutcome()) {
    this.respond = respond;
  }

  takeReset(): boolean {
    const r = this.reset;
    this.reset = false;
    return r;
  }

  enqueue(req: OpRequest): Call {
    const index = this.requests.length;
    this.requests.push(req);
    const promise = (async (): Promise<Outcome | Cancelled> => {
      try {
        if (req.stage) await req.stage();
      } catch (e) {
        if (e instanceof ToolError) return { ok: false, code: e.code, message: e.message, sessionReset: false, durationMs: 0 };
        throw e;
      }
      return this.respond(req, index);
    })();
    return { promise, cancel() {} };
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls++;
  }
}
