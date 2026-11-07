// Types for capture.mjs (plain-JS module; see change: add-mock-site-exact-env).
export declare const REDACTED: string;
export declare const SECRET_PATTERNS: [string, RegExp][];
export declare function redactHar(har: any, extra?: string[]): any;
export declare function scanSecrets(har: any): { location: string; kind: string } | null;
export declare function harToFixtures(har: any, source: string): { version: 1; source: string; entries: { method: string; path: string; query: string; status: number; contentType: string; body: string }[] };
export declare function writeFixtures(har: any, o: { out: string; source: string; redact?: string[] }): { ok: true; file: string; count: number } | { ok: false; error: string };
export declare function run(argv: string[], deps?: { cwd?: string; record?: (url: string) => Promise<any>; redact?: string[] }): Promise<{ code: number; out: string }>;
