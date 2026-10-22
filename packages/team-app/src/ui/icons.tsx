import type { AvatarSpec } from "../api/types.js";
import { GALLERY, type ICON } from "../i18n/catalog.js";
import { trustedStaticSvg } from "./trusted-static-svg.js";

/** Authored stroke icon from the approved mockup set (constant SVG paths only). */
export function Icon({ name, className = "ic" }: { name: keyof typeof ICON | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      // client-sinks: allow — trusted via pi-static-svg (constant ICON map entry)
      dangerouslySetInnerHTML={{ __html: trustedStaticSvg("icon", name) }}
    />
  );
}

function initialsOf(name: string): string {
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
  if (avatar.kind === "gallery" && Object.hasOwn(GALLERY, avatar.id)) {
    const g = GALLERY[avatar.id];
    return (
      <span className={`avatar ${size} t-${g.tint}`} aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          // client-sinks: allow — trusted via pi-static-svg (constant GALLERY map entry)
          dangerouslySetInnerHTML={{ __html: trustedStaticSvg("gallery", avatar.id) }}
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
