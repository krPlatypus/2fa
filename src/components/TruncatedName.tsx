import { useRef, useState } from 'react';

/**
 * The account name, cut to the row until the pointer is on it, then laid out
 * in full on one line over the top.
 *
 * One line, not a wrapped card. A name that wraps has to be read as a
 * paragraph; a name that simply keeps going is read the way it was read a
 * moment ago, from the same place, which is the point of showing it in place at
 * all.
 *
 * `position: fixed` rather than absolute, and that is not a style choice. The
 * popup root is `overflow-hidden` and both the compact and hidden rows put the
 * name inside a button that is `overflow-hidden` too, for the copy ripple — an
 * absolutely positioned overlay is clipped by whichever of those it meets
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
  const [box, setBox] = useState<{ top: number; left: number; maxWidth: number } | null>(null);

  /** Half the padding the overlay adds, so the glyphs do not move when it opens. */
  const INSET_X = 6;
  const INSET_Y = 2;

  const show = () => {
    const el = ref.current;
    if (!el) return;
    // Nothing is hidden, so there is nothing to reveal and no reason to paint a
    // card over a name that is already fully readable.
    if (el.scrollWidth <= el.clientWidth) return;

    const rect = el.getBoundingClientRect();
    setBox({
      top: rect.top - INSET_Y,
      left: rect.left - INSET_X,
      // As far as the popup goes and no further. A name longer than the whole
      // window still ends in an ellipsis, which is honest: there is no width
      // left to give it.
      maxWidth: window.innerWidth - rect.left + INSET_X - 8,
    });
  };

  return (
    <>
      <span ref={ref} className={`${className} truncate`} onMouseEnter={show} onMouseLeave={() => setBox(null)}>
        {label}
      </span>
      {box && (
        <span
          role="tooltip"
          style={{ position: 'fixed', top: box.top, left: box.left, maxWidth: box.maxWidth }}
          // The caller's classes carry the type — size, weight, colour — so the
          // text does not change appearance as it opens, only length. Margins
          // are dropped because the position is already absolute in the
          // viewport and a margin would slide it off the word it is covering.
          className={`${className} pointer-events-none z-[70] block truncate whitespace-nowrap rounded-md border border-gray-200 bg-white px-1.5 py-0.5 shadow-lg [margin:0] dark:border-dark-600 dark:bg-dark-800`}
        >
          {label}
        </span>
      )}
    </>
  );
}
