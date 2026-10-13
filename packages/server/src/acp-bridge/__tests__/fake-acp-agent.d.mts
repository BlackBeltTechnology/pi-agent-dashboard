import type { Readable, Writable } from "node:stream";

export interface FakeAgentKnobs {
  delayMs?: number;
  withhold?: string[];
  echoUser?: "before" | "after" | "none";
  nonJson?: boolean;
  longLine?: number;
  rejectPrompt?: boolean;
  requestFs?: boolean;
  hostileSessionId?: boolean;
  unknownVariant?: boolean;
  permission?: boolean;
  initializeVersion?: number;
  acceptedMessageId?: string;
}

export function runFakeAgent(opts: {
  input: Readable;
  output: Writable;
  protocol?: 1 | 2;
  knobs?: FakeAgentKnobs;
  fixture?: Record<string, any>;
}): { done: Promise<void>; received: Array<Record<string, any>> };
