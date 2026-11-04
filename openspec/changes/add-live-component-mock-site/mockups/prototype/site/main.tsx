// GENERIC entry: the project's setup (real CSS, i18n...) from mockup.config, then the shell.
import { createRoot } from "react-dom/client";
import { setup, Providers } from "../mockup.app.tsx";
import "./sources.css";
import "./site.css";
import { Site } from "./Site.tsx";

await setup();
createRoot(document.getElementById("root")!).render(<Providers><Site /></Providers>);
