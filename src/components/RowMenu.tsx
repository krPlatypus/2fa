import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface RowMenuItem {
  key: string;
  label: string;
  Icon: LucideIcon;
  onSelect: () => void;
  /** Drawn in red, below a divider. At most one, and it goes last. */
  danger?: boolean;
}

interface RowMenuProps {
  /** Where the pointer was, in viewport coordinates. */
  x: number;
  y: number;
  items: RowMenuItem[];
  onClose: () => void;
}

/** Enough to place the card without measuring it and repainting. */
const WIDTH = 176;
const ITEM_HEIGHT = 40;
const DIVIDER = 9;
const PADDING = 8;
const EDGE = 8;

/**
 * The row's own menu, on right-click.
 *
 * It replaced three buttons that lived on every row and appeared on hover:
 * share, edit and delete, plus a drag handle beside the name. Four controls
 * per row, in a 320px popup, for things done once in a while — they spent the
 * width the account name needed and they were the reason a long name had
 * nowhere to go.
 *
 * `position: fixed`, for the same reason TruncatedName is: the popup root is
 * `overflow-hidden`, so an absolutely positioned menu is clipped on exactly the
 * bottom rows where the list is longest. Placed from the pointer and pulled
 * back inside the window when it would hang off an edge; the size is known
 * rather than measured, which keeps it from painting once in the wrong place
 * and jumping.
 *
 * Right-click is the whole affordance, which is worth being honest about: it is
 * not discoverable the way a visible button is. A keyboard reaches it the same
 * way it reaches any context menu — Shift+F10 or the menu key, while the row's
 * copy button has focus — because the event bubbles from there to the row.
 */
export function RowMenu({ x, y, items, onClose }: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the first item so the menu can be driven from the keyboard the
    // moment it opens, and so Escape has somewhere to return from.
    ref.current?.querySelector('button')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // pointerdown rather than click: a click that lands outside should close
    // the menu and do nothing else, and closing on the way down means the
    // release never reaches whatever was underneath.
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    // Anchored to the viewport, so a list that scrolls under it leaves it
    // pointing at the wrong row. Closing is the honest answer.
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const height =
    items.length * ITEM_HEIGHT + items.filter(item => item.danger).length * DIVIDER + PADDING;
  const left = Math.max(EDGE, Math.min(x, window.innerWidth - WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE));

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top, left, width: WIDTH }}
      className="z-[80] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-600 dark:bg-dark-800"
    >
      {items.map(item => (
        <div key={item.key}>
          {/* The divider belongs to the destructive item, not to a position in
              the list: it is what stops the pointer on its way down. */}
          {item.danger && <div className="my-1 h-px bg-gray-200 dark:bg-dark-600" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-start text-sm transition-colors ${
              item.danger
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/25'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-dark-700'
            }`}
          >
            <item.Icon size={16} className="flex-shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
