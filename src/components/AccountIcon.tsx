import type { CSSProperties } from 'react';
import type { Account } from '@/types';
import { colorForKey } from '@/utils/qr-parser';
import { brandFor, type BrandIcon } from '@/utils/brand-icons';

/**
 * The mark beside an account: a brand logo where one is recognised, the
 * coloured initial where it is not.
 *
 * Still no favicons. Fetching one per service would tell whoever answers
 * exactly which sites this user holds 2FA for, and the popup makes no network
 * request to render. The logos are inlined single-path SVGs instead, and the
 * initial is what every unrecognised account keeps — see utils/brand-icons.ts
 * for what is in the pack and what its owners have had removed from it.
 */
/**
 * Black or white, whichever the background can actually carry.
 *
 * White on everything was the first attempt and it left the pale half of the
 * palette unreadable — amber came in at 2.15:1, which at this size is less a
 * letter than a rumour.
 *
 * The threshold is 0.28 rather than the 0.179 where black's contrast merely
 * overtakes white's, because at 0.179 every colour we ship flips and four of
 * them gain almost nothing for it: indigo goes from 4.47:1 to 4.70:1 and stops
 * looking like itself. 0.28 sits in the gap the palette actually has, between
 * pink at L=0.248 and orange at L=0.325 — the four pale colours get black and
 * 7.5–9.8:1, the four dark ones keep white and the look they had. Arbitrary
 * colours from an imported backup are still measured, not assumed.
 */
function readableInk(background: string): string {
  const hex = background.replace('#', '');
  if (hex.length !== 6) return '#ffffff';
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.28 ? '#000000' : '#ffffff';
}

/**
 * One brand mark, drawn bare rather than inside a circle.
 *
 * The colour arrives as two custom properties and the fill picks between them
 * per theme, which is cheaper than mounting the path twice under `dark:hidden`
 * and does not need this component to know what theme it is in.
 */
function BrandMark({ brand, size }: { brand: BrandIcon; size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ '--brand': brand.light, '--brand-dark': brand.dark } as CSSProperties}
      className="flex-shrink-0 [fill:var(--brand)] dark:[fill:var(--brand-dark)]"
    >
      <path d={brand.path} />
    </svg>
  );
}

function Initial({ account, size }: { account: Account; size: number }) {
  const issuer = typeof account.issuer === 'string' ? account.issuer : '';
  const name = typeof account.name === 'string' ? account.name : '';
  const source = (issuer || name || '?').trim();
  // Spread rather than [0]: an emoji or any astral character is a surrogate
  // pair, and indexing one splits it into half a character the font cannot draw.
  const initial = ([...source][0] || '?').toUpperCase();
  const background = account.color || colorForKey(`${issuer}:${name}:${account.id}`);
  return (
    <span
      aria-hidden
      style={{ backgroundColor: background, color: readableInk(background), width: size, height: size }}
      className="flex-shrink-0 grid place-items-center rounded-full font-semibold leading-none"
    >
      <span style={{ fontSize: Math.round(size * 0.5) }}>{initial}</span>
    </span>
  );
}

/**
 * What goes in the icon slot, in order of how much it was chosen.
 *
 * An uploaded picture beats everything, because someone went and picked it. A
 * brand mark comes next, and the coloured initial is what is left when neither
 * applies — which is every account until this pack recognises it.
 */
export function AccountIcon({
  account,
  size,
  iconUrl,
}: {
  account: Account;
  size: number;
  iconUrl?: string | null;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        aria-hidden
        width={size}
        height={size}
        // Already a 32x32 PNG when it was stored, so this only ever scales
        // down. object-contain rather than cover: the fitting happened once, at
        // upload, and cropping it again here would undo that.
        className="flex-shrink-0 rounded-sm object-contain"
      />
    );
  }

  const brand = brandFor(account.issuer);
  return brand ? <BrandMark brand={brand} size={size} /> : <Initial account={account} size={size} />;
}
