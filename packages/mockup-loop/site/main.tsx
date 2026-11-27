// GENERIC entry: the project's app module (real CSS, token bridge, providers), then the shell.
// Served by the mock-site plugin's HTML entry (the package ships no index.html).
// The pane scroll guard evaluates first: before the app module, the shell and setup().
import "./pane-scroll-guard.ts";
import { Providers, setup } from "virtual:mock-site/app";
import { createRoot } from "react-dom/client";
import "./site.css";
import { Site } from "./Site.tsx";

await setup?.();
createRoot(document.getElementById("root")!).render(<Providers><Site /></Providers>);
