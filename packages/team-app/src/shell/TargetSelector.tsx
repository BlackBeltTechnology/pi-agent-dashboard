/**
 * Project selector = the app's `HeaderContext` (D16): own workspace + allowed
 * projects, unavailable ones disabled with a reason, a plain label when only the
 * own workspace exists, a locked chip in a folder view.
 * See change: add-team-plugin (A2).
 */
import type { ProjectInfo, Target } from "../api/types.js";
import { WORKSPACE } from "../api/types.js";
import { useT } from "../i18n/index.js";
import { useEffectiveTarget } from "../state/effective-target.js";
import { Icon } from "../ui/icons.js";
import { MenuButton, type MenuItem } from "../ui/menu.js";
import { useToast } from "../ui/toast.js";

export function targetName(t: Target, projects: ProjectInfo[], wsLabel: string): string {
  return t === WORKSPACE ? wsLabel : (projects.find((p) => p.id === t)?.name ?? t);
}

export function TargetSelector() {
  const t = useT();
  const { announce } = useToast();
  const eff = useEffectiveTarget();
  if (eff.state.status !== "ready") return null;
  const projects = eff.state.projects;
  const wsLabel = t("target.ws");
  const current = eff.target;
  const name = targetName(current, projects, wsLabel);

  if (eff.locked) {
    return (
      <span className="chip target-label" data-testid="target-selector">
        <Icon name="folder" className="ic sm" />
        <span aria-hidden="true">{name}</span>
        <span className="sr-only">{t("fold.locked", { name })}</span>
      </span>
    );
  }
  if (projects.length === 0) {
    return (
      <span className="chip target-label" data-testid="target-selector">
        <Icon name="home" className="ic sm" />
        {wsLabel}
      </span>
    );
  }

  const ids = [...projects.map((p) => p.id), WORKSPACE];
  const items: MenuItem[] = ids.map((id) => {
    const proj = projects.find((p) => p.id === id);
    const unavailable = !!proj && !proj.available;
    const meta = unavailable ? t("target.unavailable") : id === WORKSPACE ? t("target.mine") : t("target.shared");
    const label = targetName(id, projects, wsLabel);
    return {
      id,
      radio: true,
      checked: id === current,
      disabled: unavailable,
      onSelect() {
        eff.setTarget(id);
        announce(t("target.switched", { name: label }));
      },
      node: (
        <>
          <Icon name={id === WORKSPACE ? "home" : "folder"} className="ic sm" />
          <span className="mi-text">
            <span className="mi-name">{label}</span>
            <span className="mi-meta">{meta}</span>
          </span>
          <span className="mi-check" aria-hidden="true">
            {id === current ? <Icon name="check" className="ic sm" /> : null}
          </span>
        </>
      ),
    };
  });

  return (
    <MenuButton
      label={t("target.switch", { name })}
      items={items}
      testId="target-selector"
      id="target-selector"
      triggerClass="btn btn-secondary target-trigger"
      menuClass="menu-wide"
      menuLabel={t("target.menu")}
      trigger={
        <>
          <Icon name={current === WORKSPACE ? "home" : "folder"} className="ic sm" />
          <span className="target-name">{name}</span>
          <Icon name="chevron" className="ic sm" />
        </>
      }
    />
  );
}
