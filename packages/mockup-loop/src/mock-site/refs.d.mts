// Types for refs.mjs (plain-JS module; see change: add-live-component-mock-site).
export declare const MOCK_ID_RE: RegExp;
export declare const RING_RE: RegExp;
export interface Ref { id: string; frame?: number; side?: "current" | "proposed"; ring?: string }
export declare function parseRef(input: string): Ref;
export declare function refId(ref: string): string;
