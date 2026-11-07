// Types for decisions.mjs (plain-JS module; see change: add-live-component-mock-site).
export interface Decision { status: "accepted" | "rejected"; by: "user" | "agent"; note?: string; at: string }
export declare function readDecisionFile(file: string): { decision?: Decision; warning?: string };
export declare function readDecisions(mocks: { id: string; dir: string }[]): { decisions: Record<string, Decision>; warnings: string[] };
export declare function writeDecision(mock: { dir: string }, d: { status: "accepted" | "rejected" | "open"; by: "user" | "agent"; note?: string }): void;
export declare const NOTE_MAX: number;
