export type TsLoaderKind = "native" | "jiti";
export declare const TS_LOADER_ENV: "PI_DASHBOARD_TS_LOADER";
export declare const NATIVE_TS_REGISTER_SPECIFIER: string;
export declare function selectTsLoader(
  env?: Record<string, string | undefined>,
  warn?: (msg: string) => void,
  transformSupported?: boolean,
): TsLoaderKind;
export declare function nativeTransformSupported(mod?: { stripTypeScriptTypes?: unknown }): boolean;
export declare function resolveNativeTsLoader(opts?: { anchor?: string }): string;
