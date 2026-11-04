// Types for discover.mjs (plain-JS module; see change: add-live-component-mock-site).
export interface MockEntry { id: string; dir: string; file: string; root: string }
export declare function mockRoots(projectRoot: string): string[];
export declare function discoverMocks(projectRoot: string): { mocks: MockEntry[]; errors: string[] };
export interface AdoptOption { entry: string; label: string; status?: string }
export declare function listAdoptable(projectRoot: string): { options: AdoptOption[]; skipped: { entry: string; reason: string }[]; warnings: string[] };
export declare function moveMockDir(src: string, changeDir: string): { ok: boolean; dest: string; error?: string };
