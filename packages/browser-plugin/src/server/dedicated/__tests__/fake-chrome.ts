/**
 * Fake Chrome child for `DedicatedChrome` tests: fd3 captures NUL-framed
 * commands, fd4 is an emitter the test drives. Replies are scripted per method.
 */
import { EventEmitter } from "node:events";
import { CHROME_INTERNAL_ID_BASE } from "../chrome-process.js";
import { encodeFrame, NulFrameDecoder } from "../pipe-framing.js";

export interface FakeChromeBehavior {
  /** Delay (ms, via setTimeout) before replying to `Browser.getVersion`; `undefined` = reply at once. */
  versionDelayMs?: number;
  /** Never answer `Browser.getVersion`. */
  silent?: boolean;
  /** Ignore `Browser.close` (Chrome hangs). */
  ignoreClose?: boolean;
  /** Answer `Browser.setDownloadBehavior` with a CDP error. */
  failDownloads?: boolean;
  /** Answer the server's ephemeral-context commands (`Target.createBrowserContext` → `ctx-N`, `Browser.setDownloadBehavior`/`Target.disposeBrowserContext` → `{}`). */
  autoContexts?: boolean;
}

export class FakeChromeChild extends EventEmitter {
  pid: number;
  /** Every command the server wrote to fd3, parsed. */
  readonly written: Array<{ id?: number; method?: string; params?: Record<string, unknown> }> = [];
  readonly fd4 = new EventEmitter();
  readonly stdio: unknown[];
  private readonly decoder = new NulFrameDecoder();

  readonly behavior: FakeChromeBehavior;
  private contextSeq = 0;

  constructor(pid: number, behavior: FakeChromeBehavior = {}) {
    super();
    this.pid = pid;
    this.behavior = behavior;
    const fd3 = {
      write: (chunk: Buffer) => {
        for (const frame of this.decoder.push(chunk)) this.onCommand(JSON.parse(frame));
        return true;
      },
      on: () => fd3,
    };
    this.stdio = [null, null, null, fd3, this.fd4];
  }

  private onCommand(msg: { id: number; method: string }): void {
    this.written.push(msg);
    const b = this.behavior;
    if (msg.method === "Browser.getVersion") {
      if (b.silent) return;
      if (b.versionDelayMs !== undefined) setTimeout(() => this.reply(msg.id, { product: "Chrome/test" }), b.versionDelayMs);
      else this.reply(msg.id, { product: "Chrome/test" });
    } else if (msg.method === "Browser.close") {
      if (b.ignoreClose) return;
      this.reply(msg.id, {});
      this.exit(0);
    } else if (b.autoContexts && this.answerContextCommand(msg)) {
      // handled
    } else if (msg.method === "Browser.setDownloadBehavior" && b.failDownloads) {
      this.emitFrame({ id: msg.id, error: { code: -32000, message: "no download support" } });
    } else if (msg.id >= CHROME_INTERNAL_ID_BASE) {
      this.reply(msg.id, {}); // server-owned commands; client commands are answered by the test
    }
  }

  /** `autoContexts`: the ephemeral-context commands of the server (ids below the internal range). */
  private answerContextCommand(msg: { id: number; method: string }): boolean {
    if (msg.method === "Target.createBrowserContext") this.reply(msg.id, { browserContextId: `ctx-${++this.contextSeq}` });
    else if (msg.id < CHROME_INTERNAL_ID_BASE && (msg.method === "Browser.setDownloadBehavior" || msg.method === "Target.disposeBrowserContext")) this.reply(msg.id, {});
    else return false;
    return true;
  }

  reply(id: number, result: object): void {
    this.emitFrame({ id, result });
  }

  /** Emit a message from Chrome (as one chunk). */
  emitFrame(msg: object): void {
    this.fd4.emit("data", encodeFrame(msg));
  }

  /** Pipe EOF. */
  eof(): void {
    this.fd4.emit("end");
    this.fd4.emit("close");
  }

  /** Process exit (pipe EOF first, like a real Chrome). */
  exit(code: number | null = 0, signal: string | null = null): void {
    this.eof();
    this.emit("exit", code, signal);
  }

  methods(): string[] {
    return this.written.map((m) => m.method ?? "");
  }
}
