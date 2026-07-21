/**
 * Offline outgoing message queue.
 * Queues messages while disconnected, delivers on reconnect.
 */
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

const MAX_QUEUE_SIZE = 10;

export class MessageQueue {
  private queue: BrowserToServerMessage[] = [];
  private sendFn: ((msg: BrowserToServerMessage) => void) | null = null;

  setSendFunction(fn: (msg: BrowserToServerMessage) => void): void {
    this.sendFn = fn;
  }

  enqueue(msg: BrowserToServerMessage): void {
    this.queue.push(msg);
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue.shift();
    }
  }

  flush(): void {
    if (!this.sendFn) return;
    const messages = [...this.queue];
    this.queue = [];
    for (const msg of messages) {
      this.sendFn(msg);
    }
  }

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}
