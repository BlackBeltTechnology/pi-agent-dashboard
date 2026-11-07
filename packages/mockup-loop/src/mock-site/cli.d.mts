// Types for cli.mjs (plain-JS module; see change: add-mock-site-exact-env).
export declare function findProjectRoot(cwd: string): string;
export declare function run(argv: string[], cwd?: string): { code: number; out: string };
