/**
 * The app proper: routes relative to the host's router base (wouter `Router`
 * is supplied by the host — `EmbeddedApp` or `standalone.tsx`).
 * Routes: / · /agent/:key · /agent/:key/c/:c · /personas/new · /personas/:key.
 * See change: add-team-plugin (D10/D16).
 */
import { useAppHost } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useEffect, useRef } from "react";
import { Route, Switch, useLocation, useSearch } from "wouter";
import { AgentView } from "./agent/AgentView.js";
import { useT } from "./i18n/index.js";
import { PersonaEditor } from "./persona/PersonaEditor.js";
import { withProject } from "./shell/nav.js";
import { useEffectiveTarget } from "./state/effective-target.js";
import { targetStore } from "./state/target-store.js";
import { TeamGrid } from "./team/TeamGrid.js";
import { ToastProvider } from "./ui/toast.js";

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Mirror the target store into `?project=` and adopt `?project=` from a deep link. */
function useTargetSync(): void {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const eff = useEffectiveTarget();
  const adopted = useRef(false);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (!eff.ready || adopted.current) return;
    adopted.current = true;
    const want = new URLSearchParams(search).get("project");
    if (want && !eff.locked && (want === "_ws" || eff.state.projects.some((p) => p.id === want && p.available))) targetStore.set(want);
  }, [eff.ready, eff.locked, eff.state.projects, search]);

  useEffect(() => {
    if (!eff.ready || !adopted.current) return;
    const cur = new URLSearchParams(search).get("project");
    if (cur !== eff.target) navigate(withProject(`${location}`, eff.target), { replace: true });
    // switching the selector while viewing an agent returns to that target's grid
    if (prev.current && prev.current !== eff.target && location.startsWith("/agent")) navigate(withProject("/", eff.target));
    prev.current = eff.target;
  }, [eff.ready, eff.target, location, search, navigate]);
}

/** Folder view: a "Teljes csapat" top-bar action opening the global app on this project (D16/D17). */
function useFolderActions(): void {
  const t = useT();
  const host = useAppHost();
  const eff = useEffectiveTarget();
  useEffect(() => {
    if (!host.folder || !eff.locked) {
      host.setActions([]);
      return;
    }
    const project = eff.target;
    host.setActions([
      {
        id: "full-team",
        label: t("fold.full"),
        icon: "people",
        onSelect: () => host.navigateDashboard(`/team/?project=${encodeURIComponent(project)}`),
      },
    ]);
    return () => host.setActions([]);
  }, [host, eff.locked, eff.target, t]);
}

function Routes() {
  const t = useT();
  const host = useAppHost();
  const search = useSearch();
  useTargetSync();
  useFolderActions();
  useEffect(() => {
    host.setTitle(t("app.name"));
  }, [host, t]);
  const fork = new URLSearchParams(search).get("fork") ?? undefined;
  return (
    <Switch>
      <Route path="/agent/:key/c/:c">{(p) => <AgentView agentKey={dec(p.key)} convId={p.c} />}</Route>
      <Route path="/agent/:key">{(p) => <AgentView agentKey={dec(p.key)} />}</Route>
      <Route path="/personas/new">
        <PersonaEditor forkKey={fork} />
      </Route>
      <Route path="/personas/:key">{(p) => <PersonaEditor editKey={dec(p.key)} />}</Route>
      <Route>
        <TeamGrid />
      </Route>
    </Switch>
  );
}

export function TeamApp() {
  return (
    <ToastProvider>
      <Routes />
    </ToastProvider>
  );
}
