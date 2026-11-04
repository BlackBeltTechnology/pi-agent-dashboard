// Types of the mock-site plugin's virtual modules + the kit alias.
declare module "virtual:mock-site/config" {
  export const MOCK_CONFIG: { title: string; themes: Array<{ id: string; label: string; attrs?: Record<string, string | null>; system?: { dark: string; light: string } }> };
}
declare module "virtual:mock-site/mocks" {
  import type { Mock } from "./kit.tsx";
  export const MOCKS: Array<{ id: string; mock: Mock }>;
  export const ERRORS: string[];
}
declare module "virtual:mock-site/app" {
  import type { ComponentType, ReactNode } from "react";
  export const setup: (() => void | Promise<void>) | undefined;
  export const Providers: ComponentType<{ children: ReactNode }>;
}
interface ImportMeta { readonly hot?: { on(event: string, cb: () => void): void } }
declare module "*.css";
