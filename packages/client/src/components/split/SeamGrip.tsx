/**
 * Always-visible dotted resize grip — the shared seam signifier used by the
 * split divider and the session-list resize seam so both read as one idiom
 * (NN/g: a signifier must be always visible, not hover-only). Purely
 * decorative: `pointer-events-none` so the grip never swallows the parent
 * seam's drag `mousedown`.
 *
 * See change: redesign-split-layout-controls.
 */

interface SeamGripProps {
  /** Dot count (divider = 4, rail seam = 3 per the approved mockup). */
  dots?: number;
  "data-testid"?: string;
}

export function SeamGrip({ dots = 4, "data-testid": testId }: SeamGripProps) {
  return (
    <div
      data-testid={testId}
      aria-hidden="true"
      className="pointer-events-none flex flex-col items-center gap-[3px]"
    >
      {Array.from({ length: dots }, (_, i) => (
        <i key={`grip-dot-${i}`} className="h-[3px] w-[3px] rounded-full bg-[var(--text-muted)]" />
      ))}
    </div>
  );
}
