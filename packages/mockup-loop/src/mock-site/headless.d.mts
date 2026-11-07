// Types for headless.mjs (plain-JS module; see change: add-mock-site-exact-env).
export interface Health { completed: number; failed: number; errors?: string[] }
type Open = (url: string) => Promise<{ health: Health; close: () => Promise<void> }>;
export declare const DEFAULT_LOOPS: number;
export declare function videoPath(root: string, spec: string, out?: string): string;
export declare function main(kind: "check" | "video", argv: string[], cwd?: string, deps?: { open?: Open }): Promise<{ code: number; out: string }>;
