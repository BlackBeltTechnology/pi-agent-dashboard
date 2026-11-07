// Types for frameworks.mjs (plain-JS module; see change: add-mock-site-exact-env).
export interface FrameworkAdapter { dedupe: string[]; include: string[] }
export declare const FRAMEWORK_ADAPTERS: Record<string, FrameworkAdapter>;
export declare const DEFAULT_FRAMEWORK: string;
export declare function frameworkProblem(framework: unknown): string | null;
