import { useState } from 'react';

/**
 * The account name, cut to the row until the pointer is on it.
 *
 * It used to open as a floating card: a tooltip of our own, fixed-positioned,
 * measured against the viewport and flipped above or below the row depending
 * on room. All of that existed to get around one fact — the popup root is
 * `overflow-hidden`, so anything absolutely positioned is clipped on exactly
 * the bottom rows where the list is longest.
 *
 * Expanding in place goes around the same fact by not leaving the flow at all.
 * The name simply stops being truncated and wraps, the row grows, and the rows
 * under it move down. No measurement, no viewport arithmetic, no stacking
 * order, and nothing that a future `transform` on an ancestor can start
 * clipping.
 *
 * There is no check for whether the text is actually truncated, because none is
 * needed: a name that already fits wraps to the same single line and nothing
 * moves.
 *
 * `overflow-wrap: anywhere` earns its place on the long ones. A hostname has no
 * spaces to break at, so without it a wrapped `gitlab.spade.company` is one
 * unbreakable line that widens the row instead of filling it.
 */
export function TruncatedName({ label, className }: { label: string; className: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`${className} ${open ? '[overflow-wrap:anywhere] whitespace-normal' : 'truncate'}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {label}
    </span>
  );
}
