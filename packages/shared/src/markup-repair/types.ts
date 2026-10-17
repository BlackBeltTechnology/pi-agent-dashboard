/** Shared result shape of the markdown / AsciiDoc markup repair functions. */
export type MarkupRepairRule = "M2" | "M3" | "A1" | "A2";

export interface MarkupRepair {
  rule: MarkupRepairRule;
  /** 1-based line in the ORIGINAL source (block opener; A1: the attribute line). */
  line: number;
}

export interface MarkupRepairResult {
  source: string;
  repairs: MarkupRepair[];
}
