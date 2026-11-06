// Types for browser.mjs (plain-JS module; see change: add-mock-site-exact-env).
export declare const INSTALL_HINT: string;
export declare function cachedChromiumBuilds(dir: string): { name: string; exe: string }[];
export declare function launchChromium(
  chromium: { launch: (o: object) => Promise<any> },
  launchOpts?: object,
  deps?: { builds?: { name: string; exe: string }[] },
): Promise<{ browser: any; build: string }>;
