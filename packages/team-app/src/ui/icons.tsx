import { GALLERY, ICON } from "../i18n/catalog.js";
import type { AvatarSpec } from "../api/types.js";

/** Authored stroke icon from the approved mockup set (constant SVG paths only). */
export function Icon({ name, className = "ic" }: { name: keyof typeof ICON | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: constant, authored SVG path data (never user input)
      dangerouslySetInnerHTML={{ __html: ICON[name] ?? "" }}
    />
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0].toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({ avatar, name, size = "" }: { avatar: AvatarSpec; name: string; size?: "" | "lg" | "sm" }) {
  if (avatar.kind === "gallery" && GALLERY[avatar.id]) {
    const g = GALLERY[avatar.id];
    return (
      <span className={`avatar ${size} t-${g.tint}`} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: constant, authored gallery SVG
          dangerouslySetInnerHTML={{ __html: g.svg }}
        />
      </span>
    );
  }
  return (
    <span className={`avatar ${size} t-neutral`} aria-hidden="true">
      {initialsOf(name || "?")}
    </span>
  );
}
