import { useEffect, useRef, useState } from 'react';

/**
 * The account name, cut to the row until the pointer is on it, and then simply
 * longer.
 *
 * Not a tooltip. Nothing appears, nothing is announced, no card is drawn over
 * the row — the same text in the same place in the same type keeps going past
 * where it was cut, in one line, and rolls back when the pointer leaves. The
 * only thing behind it is the row's own colour, which is there so the words it
 * grows over do not show through.
 *
 * `position: fixed` rather than absolute, and that is not a style choice. The
 * popup root is `overflow-hidden` and both the compact and hidden rows put the
 * name inside a button that is `overflow-hidden` too, for the copy ripple — an
 * absolutely positioned element is clipped by whichever of those it meets
 * first. Fixed is measured against the viewport and no ancestor's `overflow`
 * touches it, as long as none of them establishes a containing block with
 * `transform`, `filter` or `will-change`. None does today; if one ever appears
 * above this component, this is what will start being cut off.
 *
 * Measured on hover rather than watched. One getBoundingClientRect when the
 * pointer arrives costs nothing; a ResizeObserver per row costs it forty-five
 * times over.
 */
export function TruncatedName({ label, className }: { label: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; from: number; to: number } | null>(null);
  const [open, setOpen] = useState(false);

  /** Half the padding the overlay adds, so the glyphs do not move as it opens. */
  const INSET_X = 6;
  const INSET_Y = 2;

  const show = () => {
    const el = ref.current;
    if (!el) return;
    // Nothing is hidden, so there is nothing to unfurl and no reason to paint
    // anything over a name that is already whole.
    if (el.scrollWidth <= el.clientWidth) return;

    const rect = el.getBoundingClientRect();
    setBox({
      top: rect.top - INSET_Y,
      left: rect.left - INSET_X,
      // Starts at exactly the width it is cut to, so the first frame is
      // indistinguishable from the row underneath it.
      from: el.clientWidth + INSET_X * 2,
      // As far as the name needs, or as far as the window allows. A name longer
      // than the window still ends in an ellipsis, which is honest: there is no
      // width left to give it.
      to: Math.min(el.scrollWidth + INSET_X * 2, window.innerWidth - rect.left + INSET_X - 8),
    });
  };

  // The second frame is what makes it a movement rather than a jump: the
  // element has to exist at its starting width before the width it is going to
  // can be transitioned to.
  useEffect(() => {
    if (!box) return;
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => {
      cancelAnimationFrame(frame);
      setOpen(false);
    };
  }, [box]);

  return (
    <>
      <span
        ref={ref}
        className={`${className} truncate`}
        onMouseEnter={show}
        onMouseLeave={() => setBox(null)}
      >
        {label}
      </span>
      {box && (
        <span
          aria-hidden
          style={{
            position: 'fixed',
            top: box.top,
            left: box.left,
            width: open ? box.to : box.from,
            transition: 'width 180ms ease-out',
          }}
          // The caller's classes carry the type — size, weight, colour — so
          // nothing about the text changes as it opens, only how much of it
          // there is. Margins are dropped because the position is already
          // absolute in the viewport and a margin would slide it off the word
          // it is standing on. The background is the row's hovered colour,
          // because the pointer is on the row whenever this is visible.
          className={`${className} pointer-events-none z-[70] block truncate whitespace-nowrap rounded-sm bg-gray-50 px-1.5 py-0.5 [margin:0] dark:bg-dark-700`}
        >
          {label}
        </span>
      )}
    </>
  );
}
