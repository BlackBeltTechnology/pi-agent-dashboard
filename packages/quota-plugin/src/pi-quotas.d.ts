/**
 * Ambient declaration for the deep raw-TS entry of `@latentminds/pi-quotas`.
 *
 * The published 0.4.0 package ships raw TypeScript in `src/` with NO
 * `main`/`exports` map, so we deep-import the fetch core directly. Because the
 * package has no `exports` field, Node/jiti permit this subpath; the dashboard
 * server runs entirely through jiti, which transpiles the `.ts` on the fly
 * (verified empirically). Pinned to 0.4.0 to insulate against internal-layout
 * drift. This declaration decouples our typecheck from the dependency's own
 * types (which reference an unrelated pi-coding-agent peer) — see
 * design.md "Packaging (Task 0)".
 */
declare module "@latentminds/pi-quotas/src/lib/quotas.js" {
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
}
