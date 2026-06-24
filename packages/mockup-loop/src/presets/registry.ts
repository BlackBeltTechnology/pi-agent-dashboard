/**
 * Design-system preset registry.
 *
 * One entry per selectable design system. Each preset declares its platform,
 * generation substrate, contract source, touch-target minimum, spacing scale,
 * and the validator layers (L1–L4) that apply. The loop reads this to drive
 * generation conventions and the validation pipeline.
 *
 * v1: shadcn, mui, material-3, fluent-2, apple-hig.
 */

export type Platform = "web" | "ios";

/** Where a preset's token contract comes from. */
export type ContractSource = "imported-tokens" | "rule-pack";

export type ValidatorLayer = "L1" | "L2" | "L3" | "L4";

/**
 * One validator wired into a preset.
 * - `gate`    — hard gate (blocks `pass`) vs advisory (scores only).
 * - `bundled` — a hard dependency shipped with the package vs an optional
 *               tool resolved at runtime (skipped + noted when absent).
 */
export interface ValidatorSpec {
  layer: ValidatorLayer;
  tool: string;
  gate: boolean;
  bundled: boolean;
}

export interface DesignSystemPreset {
  id: string;
  label: string;
  platform: Platform;
  /** Generation substrate, e.g. "html-tailwind", "html-approx + swiftui-on-promote". */
  substrate: string;
  contractSource: ContractSource;
  /** Minimum touch target, in CSS px (web) or pt (ios). */
  minTouchTarget: number;
  spacingScale: number[];
  validators: ValidatorSpec[];
}

/** L2 a11y floor — bundled, hard gate, applies to every preset. */
const L2_FLOOR: ValidatorSpec = {
  layer: "L2",
  tool: "@axe-core/playwright",
  gate: true,
  bundled: true,
};

export const PRESETS: DesignSystemPreset[] = [
  {
    id: "shadcn",
    label: "shadcn/ui + Tailwind",
    platform: "web",
    substrate: "html-tailwind",
    contractSource: "imported-tokens",
    minTouchTarget: 44,
    spacingScale: [4, 8, 12, 16, 24, 32, 48, 64],
    validators: [
      { layer: "L1", tool: "eslint-plugin-tailwindcss", gate: true, bundled: true },
      L2_FLOOR,
      { layer: "L4", tool: "rubric", gate: false, bundled: true },
    ],
  },
  {
    id: "mui",
    label: "Material UI (MUI)",
    platform: "web",
    substrate: "html-mui",
    contractSource: "imported-tokens",
    minTouchTarget: 48,
    spacingScale: [4, 8, 16, 24, 32, 40, 48],
    validators: [
      { layer: "L1", tool: "eslint-plugin-material-ui", gate: false, bundled: false },
      L2_FLOOR,
      { layer: "L3", tool: "mui-mcp", gate: false, bundled: false },
      { layer: "L4", tool: "rubric", gate: false, bundled: true },
    ],
  },
  {
    id: "material-3",
    label: "Material Design 3",
    platform: "web",
    substrate: "html-md3",
    contractSource: "imported-tokens",
    minTouchTarget: 48,
    spacingScale: [4, 8, 16, 24, 32, 40, 48, 56],
    validators: [
      { layer: "L1", tool: "stylelint-scales", gate: true, bundled: true },
      L2_FLOOR,
      { layer: "L3", tool: "material3-mcp", gate: false, bundled: false },
      { layer: "L4", tool: "rubric", gate: false, bundled: true },
    ],
  },
  {
    id: "fluent-2",
    label: "Fluent 2",
    platform: "web",
    substrate: "html-fluent",
    contractSource: "imported-tokens",
    minTouchTarget: 44,
    spacingScale: [4, 8, 12, 16, 20, 24, 32],
    validators: [
      { layer: "L1", tool: "eslint-plugin-fluentui-jsx-a11y", gate: false, bundled: false },
      L2_FLOOR,
      { layer: "L4", tool: "rubric", gate: false, bundled: true },
    ],
  },
  {
    id: "apple-hig",
    label: "Apple Human Interface Guidelines",
    platform: "ios",
    substrate: "html-approx + swiftui-on-promote",
    contractSource: "rule-pack",
    minTouchTarget: 44,
    spacingScale: [4, 8, 16, 20, 24, 32, 44],
    validators: [
      L2_FLOOR,
      { layer: "L3", tool: "hig-doctor", gate: false, bundled: false },
      { layer: "L4", tool: "rubric", gate: false, bundled: true },
    ],
  },
];

export function listPresets(): DesignSystemPreset[] {
  return PRESETS;
}

export function getPreset(id: string): DesignSystemPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function presetIds(): string[] {
  return PRESETS.map((p) => p.id);
}

/**
 * Resolve a preset or return a structured error naming valid ids.
 * Tools call this to reject unknown `system` values without throwing.
 */
export function resolvePreset(
  id: string,
): { preset: DesignSystemPreset } | { error: string } {
  const preset = getPreset(id);
  if (!preset) {
    return {
      error: `Unknown design system "${id}". Valid ids: ${presetIds().join(", ")}.`,
    };
  }
  return { preset };
}
