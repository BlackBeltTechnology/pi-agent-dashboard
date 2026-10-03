// Domain model of the order service.

export type OrderStatus = "draft" | "submitted" | "approved" | "shipped" | "cancelled";

export type Priority = "normal" | "express";

export type CustomerTier = "standard" | "gold";

export interface OrderLine {
  sku: string;
  quantity: number; // whole units, 1..100
  unitPrice: number; // currency units, 2 decimals
}

export interface Order {
  id: string; // "ord-<n>", assigned on creation, never reused
  customerTier: CustomerTier;
  priority?: Priority; // optional on input; see parseOrder for the default
  coupon?: string;
  lines: OrderLine[];
  status: OrderStatus;
}

export interface OrderInput {
  customerTier?: string;
  priority?: Priority;
  coupon?: string;
  lines: OrderLine[];
}

export function parseOrder(input: OrderInput, id: string): Order {
  return {
    id,
    customerTier: input.customerTier === "gold" ? "gold" : "standard",
    priority: input.priority ?? "normal",
    coupon: input.coupon,
    lines: input.lines,
    status: "draft",
  };
}
