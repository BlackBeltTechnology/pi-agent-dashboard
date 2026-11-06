// GENERIC entry: the project's app module (real CSS, token bridge, providers), then the shell.
// Served by the mock-site plugin's HTML entry (the package ships no index.html).
import { createRoot } from "react-dom/client";
import { setup, Providers } from "virtual:mock-site/app";
import "./site.css";
import { Site } from "./Site.tsx";

await setup?.();
createRoot(document.getElementById("root")!).render(<Providers><Site /></Providers>);
