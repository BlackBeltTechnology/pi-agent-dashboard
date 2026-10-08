import { validate } from "./orders";
import { totalFor } from "./pricing";
import { type OrderInput, parseOrder } from "./model";

// Agent tools registered by the service host.
export const TOOLS = [
  {
    name: "orders_quote",
    description: "Price an order without storing it",
    run: (input: OrderInput) => {
      const order = parseOrder(input, "quote");
      validate(order);
      return { total: totalFor(order) };
    },
  },
];
