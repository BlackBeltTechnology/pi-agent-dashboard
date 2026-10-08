import type { Order } from "./model";

export const VAT_RATE = 0.27;
export const EXPRESS_FEE = 15;

const COUPONS: Record<string, number> = { WELCOME10: 0.1, SPRING5: 0.05 };

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function subtotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
}

// Volume discount: highest matching tier wins.
export function volumeDiscountRate(amount: number): number {
  if (amount >= 1000) return 0.1;
  if (amount >= 500) return 0.05;
  return 0;
}

function couponRate(code: string): number {
  const rate = COUPONS[code];
  if (rate === undefined) throw new Error(`unknown coupon ${code}`);
  return rate;
}

export function totalFor(order: Order): number {
  const base = subtotal(order);
  let rate = volumeDiscountRate(base);
  if (order.coupon) {
    try {
      rate = Math.max(rate, couponRate(order.coupon));
    } catch {
      // keep the volume rate
    }
  }
  if (order.customerTier === "gold") rate += 0.02;
  const discounted = base * (1 - rate);
  const shipping = order.priority === "express" ? EXPRESS_FEE : 0;
  return round2((discounted + shipping) * (1 + VAT_RATE));
}
