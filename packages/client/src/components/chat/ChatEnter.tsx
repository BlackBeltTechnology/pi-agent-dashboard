import { type ComponentPropsWithRef, useState } from "react";
import { CHAT_ENTER_CLASS } from "../../lib/chat/chat-motion-context.js";

/**
 * A `div` that plays the live-arrival entry transition iff `entering` was true
 * when THIS instance first rendered. The decision is latched in `useState`, so
 * the class never re-triggers and removing it can never cut a transition short.
 * With `entering` false it renders a plain `div` — byte-identical to today.
 *
 * See change: add-fluid-chat-motion (D2).
 */
export function ChatEnter({
  entering,
  className,
  children,
  ...rest
}: { entering: boolean } & ComponentPropsWithRef<"div">) {
  const [latched] = useState(entering);
  const cls = latched ? (className ? `${className} ${CHAT_ENTER_CLASS}` : CHAT_ENTER_CLASS) : className;
  return (
    <div {...rest} className={cls}>
      {children}
    </div>
  );
}
