/**
 * Type stub for the deep raw-TS entry of `@latentminds/pi-quotas`.
 *
 * The published 0.4.0 package ships raw TypeScript in `src/` with NO
 * `main`/`exports` map, so the server entry deep-imports the fetch core
 * directly (permitted because the package has no `exports` field; the dashboard
 * server runs through jiti, which transpiles the `.ts` on the fly — verified
 * end-to-end).
 *
 * tsc, however, would otherwise resolve that import to the dependency's real
 * `.ts` and compile it — and those files import `AuthStorage` from a peer
 * (`@mariozechner/pi-coding-agent`) that this repo does not install, failing the
 * `tsc --noEmit` lint. `tsconfig.base.json#paths` redirects the specifier to
 * THIS declaration so tsc uses these types instead of the dependency's source.
 * Runtime (jiti) and vitest (`vi.mock`) ignore tsconfig paths and resolve the
 * real module. See design.md "Packaging (Task 0)".
 */
export interface QuotaWindow {
  provider: string;
  label: string;
  usedPercent: number;
  resetsAt: Date;
  windowSeconds: number;
  usedValue: number;
  limitValue: number;
  isCurrency?: boolean;
  showPace?: boolean;
  paceScale?: number;
  limited?: boolean;
}

export type QuotasResult =
  | { success: true; data: { windows: QuotaWindow[]; provider: string } }
  | { success: false; error: { message: string; kind: string } };

export const SUPPORTED_PROVIDERS: string[];

export function fetchProviderQuotas(
  authStorage: unknown,
  provider: string,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<QuotasResult>;

export function fetchAllProviderQuotas(
  authStorage: unknown,
  options?: { force?: boolean; signal?: AbortSignal },
): Promise<Array<{ provider: string; result: QuotasResult }>>;

export function clearQuotaCache(provider?: string): void;
