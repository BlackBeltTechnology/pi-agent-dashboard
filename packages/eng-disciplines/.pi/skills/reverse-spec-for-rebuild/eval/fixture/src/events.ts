// WebSocket broadcast of order lifecycle events to every connected client.
export type OrderEvent =
  | { type: "order.submitted"; orderId: string }
  | { type: "order.approved"; orderId: string }
  | { type: "order.cancelled"; orderId: string };

type Listener = (event: OrderEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publish(event: OrderEvent): void {
  for (const l of listeners) l(event);
}
