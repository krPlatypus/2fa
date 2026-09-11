import { useState, type CSSProperties, type PointerEvent } from 'react';
import { Check, Trash2, Pencil, Share2 } from 'lucide-react';
import type { Account } from '@/types';
import { accountLabel } from '@/utils/account-label';
import { toast } from '@/utils/ui-feedback';
import { useTOTP } from '@/hooks/useTOTP';
import { codeUrgency } from '@/utils/totp';
import { createT, type Language } from '@/utils/i18n';
import { recordAccountUsage } from '@/utils/suggestions';
import { takePickPrompt } from '@/utils/quick-fill';
import { AccountIcon } from './AccountIcon';
import { RowMenu, type RowMenuItem } from './RowMenu';
import { ProgressRing } from './ProgressRing';
import { TruncatedName } from './TruncatedName';

export type ViewMode = 'normal' | 'compact' | 'hidden';

interface AccountCardProps {
  account: Account;
  onDelete: (id: string) => void;
  onEdit: (account: Account) => void;
  /** Opens the share dialog. Absent on the broken-record row: no code, no link. */
  onShare: (account: Account) => void;
  language: Language;
  viewMode?: ViewMode;
  /** Off by default — see the toggle in Settings and the note beside it. */
  showIcon?: boolean;
  /** A picture the user uploaded for this account; overrides mark and initial. */
  iconUrl?: string | null;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, id: string) => void;
  isDragOver?: boolean;
  currentDomain?: string | null;
  isSuggested?: boolean;
  /** Off while the list is already filtered to one group — the chip says it. */
  showGroup?: boolean;
}

export function AccountCard({
  account,
  onDelete,
  onEdit,
  onShare,
  language,
  viewMode = 'normal',
  showIcon = true,
  iconUrl,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
  currentDomain,
  isSuggested,
  showGroup,
}: AccountCardProps) {
  const t = createT(language);
  const totp = useTOTP(account);
  const [copied, setCopied] = useState(false);
  const [ripple, setRipple] = useState<{ id: number; style: CSSProperties } | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  /**
   * A circle that grows out of where the pointer landed.
   *
   * On pointerdown rather than on click, because the acknowledgement people
   * read as "it heard me" has to land before the clipboard write resolves —
   * that write is a promise, and on a denied or slow one there was previously
   * nothing at all between the press and the tick.
   *
   * Sized to the diagonal so the circle covers the corner furthest from wherever
   * it started, and cleared on animationend rather than a timer: the CSS owns
   * the duration, and a timeout here would be a second copy of it to keep in
   * step.
   */
  const startRipple = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const size = Math.hypot(box.width, box.height) * 2;
    setRipple({
      id: Date.now(),
      style: {
        width: size,
        height: size,
        left: event.clientX - box.left - size / 2,
        top: event.clientY - box.top - size / 2,
      },
    });
  };

  const handleCopy = async () => {
    if (!totp) return;
    try {
      await navigator.clipboard.writeText(totp.code);
    } catch (error) {
      // Rejected when the document is not focused, or by policy. Named rather
      // than logged as the object: a DOMException prints as
      // "[object DOMException]" and says nothing, and the name is the whole
      // diagnosis — NotAllowedError with devtools holding focus is not the same
      // problem as one without.
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error('Could not copy the code to the clipboard —', detail);
      // And said out loud. The console line above was added because failing
      // silently left a failed copy indistinguishable from a misclick, which it
      // still did — nothing on screen changed either way.
      toast('error', t('accounts.copyFailed'));
      return;
    }
    setCopied(true);
    // Shorter than the two seconds the old label sat there for. The digits are
    // green while this lasts, and green is also how the row says "plenty of
    // time left" — holding it makes the code look calm at the moment it is
    // about to expire.
    setTimeout(() => setCopied(false), 1200);
    if (currentDomain) {
      // What this copy is worth depends on why the popup is open. Opened by
      // quick fill because it could not tell which account this site wants,
      // the answer names the site. Opened from the toolbar, the code may
      // equally be going into a desktop VPN client or an SSH prompt, and the
      // site behind the popup is a coincidence.
      takePickPrompt(currentDomain)
        .then(answeredPrompt => recordAccountUsage(currentDomain, account.id, answeredPrompt ? 'site' : 'copy'))
        .catch(() => {});
    }
  };

  // Keyed on the press, so a second tap restarts the circle rather than
  // letting the first one finish on its own. Only one row renders at a time,
  // so one node serves all three.
  const rippleNode = ripple ? (
    <span
      key={ripple.id}
      aria-hidden="true"
      onAnimationEnd={() => setRipple(null)}
      className="copy-ripple pointer-events-none absolute rounded-full bg-[#4285F4]"
      style={ripple.style}
    />
  ) : null;

  const suggestedBadge = isSuggested ? (
    <span className="flex-shrink-0 text-[10px] font-medium leading-none text-[#4285F4] bg-blue-50/70 dark:bg-blue-900/25 border border-blue-200/70 dark:border-blue-800/60 px-1.5 py-[3px] rounded-full">
      {t('accounts.suggested')}
    </span>
  ) : null;

  // Typed, not assumed: `group` can come from an imported file, and until the
  // import path started coercing it a number here threw on `.trim()` and took
  // the whole popup down with it.
  const groupName = typeof account.group === 'string' ? account.group.trim() : '';

  /**
   * The label, and the title every branch hands the browser.
   *
   * Each of the four branches below truncates it, and at the 320px popup it
   * truncates hard enough that two accounts on one service stop being
   * distinguishable — the name is the only thing on the row that can give way.
   * A native title rather than a tooltip of our own: the popup root is
   * overflow-hidden, so an absolutely positioned one would be clipped on
   * exactly the bottom rows where the list is longest.
   */
  const fullName = accountLabel(account);

  /**
   * The service and account the label is standing in for.
   *
   * Only when there is a label. Without one the title is already "issuer:
   * name", and printing the same two words underneath it is noise.
   *
   * Name first, then issuer, which is the reverse of the title's order on
   * purpose: the title says what this row is, and this line answers "which
   * account, on what" — the account is the part being asked about.
   */
  const subtitle =
    typeof account.label === 'string' && account.label.trim()
      ? [
          typeof account.name === 'string' ? account.name.trim() : '',
          typeof account.issuer === 'string' ? account.issuer.trim() : '',
        ]
          .filter(Boolean)
          .join(' | ')
      : '';

  /**
   * @param compact Halves the cap and lets the badge shrink.
   *
   * The compact row is one line where the name is the only thing that can give
   * way, so a wide badge eats it: at the default width a 110px badge left about
   * four characters of the account name, and at the 320px "Small" popup the row
   * overflowed outright. Truncating the group — which the chip strip above
   * already names — costs less than truncating the account.
   */
  const badgeClass = (compact: boolean) =>
    `${compact ? 'min-w-0 max-w-[70px]' : 'flex-shrink-0 max-w-[110px]'} truncate text-[10px] font-medium leading-none text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-dark-700 border border-gray-200 dark:border-dark-600 px-1.5 py-[3px] rounded-full`;

  const groupBadgeFor = (compact: boolean) =>
    showGroup && groupName ? <span className={badgeClass(compact)} title={groupName}>{groupName}</span> : null;

  const groupBadge = groupBadgeFor(false);

  /**
   * The code in groups of three, held apart by a margin rather than a space.
   *
   * A space is as wide as the font decides — around a quarter of an em — and
   * `tracking-wide` widens it again on top, which left most of a digit's worth
   * of air in the middle of a six-digit code and read as two numbers instead of
   * one. 0.16em is a seam rather than a gap: enough to group the halves, not
   * enough to split them.
   *
   * It also removes the last bidi-neutral character from between the digits.
   * The space used to resolve to the paragraph direction under RTL and lay
   * "123 456" out with 456 first — see the `dir="ltr"` below, which is what
   * caught it. With nothing neutral left in there, there is nothing to
   * resolve.
   */
  const codeDigits = totp
    ? (totp.code.match(/.{1,3}/g) ?? [totp.code]).map((group, index) => (
        <span key={index} className={index > 0 ? 'ms-[0.16em]' : undefined}>
          {group}
        </span>
      ))
    : null;
  // Blue while there is time, amber under fifteen seconds, red under five —
  // and the pulse held back for the red, so that the movement means "now" and
  // not merely "soon". codeUrgency owns the thresholds; see utils/totp.ts.
  const urgency = totp ? codeUrgency(totp.remaining, totp.period) : 'calm';
  /**
   * What the code is drawn in, and what says it was copied.
   *
   * The clipboard icon that used to sit beside the code is gone with the button
   * it belonged to: it pointed at a target about a third of the row wide, and
   * the target is now the row. So the row answers instead — a green wash
   * through it, the digits green while it lasts, and a tick over the ring.
   *
   * Three of them because two of them are colour, and colour alone is not a
   * message to everyone who uses this. The tick is the same thing said in a
   * shape.
   */
  const codeColour =
    copied
      ? 'text-green-600 dark:text-green-400'
      : urgency === 'critical'
        ? 'text-red-500 dark:text-red-400 animate-pulse'
        : urgency === 'warning'
          ? 'text-amber-500 dark:text-amber-400'
          : 'text-[#4285F4]';

  /** The wash, rendered inside the row — which is `relative overflow-hidden`. */
  const copyFlash = copied ? (
    <span
      aria-hidden
      className="copy-flash pointer-events-none absolute inset-0 bg-emerald-500/25 dark:bg-emerald-400/20"
    />
  ) : null;

  /**
   * The tick, over the ring rather than beside the code.
   *
   * The ring is the only other thing on the row and it keeps running
   * underneath, so this costs no space and takes nothing away — a second
   * without the countdown would be a second of the one number the row exists
   * to show.
   */

  /**
   * Share, edit and delete, on right-click.
   *
   * They used to be three buttons on every row, faded in on hover. In a 320px
   * popup that is a permanent tax on the width the account name needed, paid
   * for things done once in a while. The drag handle went the same way — the
   * row has always been draggable by itself, and the handle only said so.
   *
   * Delete last and apart, which is what the divider in RowMenu is for.
   */
  const menuItems: RowMenuItem[] = [
    { key: 'edit', label: t('edit.title'), Icon: Pencil, onSelect: () => onEdit(account) },
    { key: 'share', label: t('share.title'), Icon: Share2, onSelect: () => onShare(account) },
    {
      key: 'delete',
      label: t('accounts.deleteAccount'),
      Icon: Trash2,
      onSelect: () => onDelete(account.id),
      danger: true,
    },
  ];

  const openMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };

  const menuNode = menuAt ? (
    <RowMenu x={menuAt.x} y={menuAt.y} items={menuItems} onClose={() => setMenuAt(null)} />
  ) : null;

  const dragProps = {
    onContextMenu: openMenu,
    draggable,
    onDragStart: (e: React.DragEvent) => onDragStart?.(e, account.id),
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); onDragOver?.(e); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); onDrop?.(e, account.id); },
  };

  const baseClass = `relative group group/copy overflow-hidden cursor-pointer bg-white dark:bg-dark-800 hover:bg-gray-50 dark:hover:bg-dark-700 transition-all duration-200 after:content-[''] after:absolute after:bottom-0 after:h-px after:bg-gray-200 dark:after:bg-dark-600 last:after:hidden ${
    isDragOver ? 'border-t-2 border-[#4285F4]' : ''
  }`;

  /**
   * The whole row copies, not a button inside it.
   *
   * The target used to be the code and the little clipboard beside it, which is
   * a strip about a third of the row wide in a window this narrow — and the
   * rest of the row, the part with the name on it, did nothing at all. The
   * ripple follows on its own: it is sized from whatever was pressed.
   *
   * A div rather than a button, because a button's content model is phrasing
   * content and every one of these rows is flex boxes and an SVG. role and
   * tabIndex put it back on the keyboard, and Enter and Space do what the
   * button did. That also gives the row focus of its own, which is what
   * Shift+F10 needs to reach the context menu.
   */
  const rowProps = {
    ...dragProps,
    role: 'button' as const,
    tabIndex: 0,
    onClick: handleCopy,
    onPointerDown: startRipple,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Space scrolls a list by default, and this one is inside a list.
      event.preventDefault();
      void handleCopy();
    },
    'aria-label': fullName,
  };

  /**
   * A record whose secret cannot produce a code.
   *
   * Placed ahead of the three view modes so every one of them is covered by a
   * single branch. It deliberately keeps Edit and Delete reachable: this row is
   * the only handle the user has on a record that would otherwise be unfixable
   * from inside the app, and the secret is very often one paste away from being
   * correct.
   */
  if (!totp) {
    return (
      <div
        {...rowProps}
        className={`${baseClass} py-3 ${viewMode === 'compact' ? 'px-3 after:inset-x-3' : 'px-4 after:inset-x-4'}`}
      >
        {menuNode}
        {rippleNode}
        {copyFlash}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <TruncatedName
              label={fullName}
              className="block text-sm font-medium text-gray-900 dark:text-gray-100"
            />
            <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">
              {t('accounts.invalidSecret')}
            </div>
          </div>

        </div>
      </div>
    );
  }

  const ringWithTick = (size?: number) => (
    <span className="relative flex-shrink-0">
      <ProgressRing remaining={totp.remaining} period={totp.period} size={size} />
      {copied && (
        <span className="copied-in absolute inset-0 grid place-items-center rounded-full bg-white/85 text-green-600 dark:bg-dark-800/85 dark:text-green-400">
          <Check size={size && size < 32 ? 13 : 16} aria-hidden />
        </span>
      )}
    </span>
  );

  // Hidden mode — just name, click whole row to copy
  if (viewMode === 'hidden') {
    return (
      <div {...rowProps} className={`${baseClass} px-4 py-2.5 after:inset-x-4`}>
        {menuNode}
        {rippleNode}
        {copyFlash}
        <div className="flex items-center gap-2">

          <div className="relative flex-1 min-w-0 flex items-center gap-2 text-start">
            {showIcon && <AccountIcon account={account} size={18} iconUrl={iconUrl} />}
            <TruncatedName
              label={fullName}
              className="min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100"
            />
            {suggestedBadge}
            {groupBadgeFor(true)}
          </div>


          {/* Same 26px ring as the compact row: at the default 40 the mode that
              hides the codes ended up the tallest of the three. */}
          <div className="flex-shrink-0">
            {ringWithTick(26)}
          </div>
        </div>
      </div>
    );
  }

  // Compact mode — one row per account.
  //
  // Stacking the name over the code left compact barely shorter than a normal
  // card while opening a wide gap between the code and the ring. On one line the
  // name takes the slack, the code sits against the ring, and twice as many
  // accounts fit on screen — which is the only reason to pick this mode.
  if (viewMode === 'compact') {
    return (
      // overflow-hidden so a row that runs out of width clips instead of laying
      // the code and the copy icon over the hover actions and the ring.
      // px-3 and gap-1.5 rather than px-4 and gap-2, and no drag handle: at the
      // 320px popup the fixed furniture of this row left the name about 78px —
      // ten characters — so two accounts on one service read identically. The
      // padding, the gaps and the handle give back 44px between them without
      // moving anything the row exists to show; the avatar spends 24 of it, so
      // the name's measured gain is 26px — 80px to 106px at this width.
      //
      // The drag goes with the handle. A row that still reorders with no
      // affordance, and jumps 2px mid-drag when isDragOver lands, is worse than
      // a row that does not reorder; that stays a normal-view job.
      <div {...rowProps} className={`${baseClass} py-1.5 px-3 after:inset-x-3`}>
        {menuNode}
        {rippleNode}
        {copyFlash}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0 flex items-center gap-1.5 text-start">
            {showIcon && <AccountIcon account={account} size={18} iconUrl={iconUrl} />}
            {/* min-w-0: a flex item will not shrink below its content without
                it, so a long name would push the code off the row instead of
                truncating. */}
            <TruncatedName
              label={fullName}
              className="min-w-0 text-sm text-gray-700 dark:text-gray-300"
            />
            {suggestedBadge}
            {groupBadgeFor(true)}
            <span
              dir="ltr"
              className={`ms-auto flex-shrink-0 font-otp text-base tracking-wide transition-colors ${codeColour}`}
            >
              {codeDigits}
            </span>
          </div>


          <div className="flex-shrink-0">
            {ringWithTick(26)}
          </div>
        </div>
      </div>
    );
  }

  // Normal mode
  return (
    <div {...rowProps} className={`${baseClass} p-3 px-4 after:inset-x-4`}>
      {menuNode}
        {rippleNode}
        {copyFlash}
      {/* One row: the icon on the left, the name and the code stacked beside
          it, the ring on the right. The icon used to sit inline with the name,
          which left the code beginning at the card edge underneath it and made
          the icon read as part of the title rather than as the account.

          32px because that is the size an uploaded picture is stored at, so it
          draws one pixel to one and never softens. Anything larger would be an
          upscale of a 32x32 PNG. */}
      <div className="flex items-center gap-3">
        {showIcon && <AccountIcon account={account} size={32} iconUrl={iconUrl} />}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between mb-1.5">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {/* The title and its subtitle stack, so the badges beside them
                  centre against the pair rather than against the first line. */}
              <div className="min-w-0 flex-1">
                <TruncatedName
                  label={fullName}
                  className="block text-sm font-medium text-gray-900 dark:text-gray-100"
                />
                {subtitle && (
                  <TruncatedName
                    label={subtitle}
                    className="mt-0.5 block text-[11px] leading-tight text-gray-500 dark:text-gray-400"
                  />
                )}
              </div>
              {suggestedBadge}
              {groupBadge}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="relative flex flex-1 items-center gap-2 text-start">
              {/* dir="ltr" is load-bearing, not tidiness. The code is drawn in
                  groups of three separated by a space, and under RTL the bidi
                  algorithm resolves that neutral space to the paragraph direction:
                  "123 456" lays out with 456 to the LEFT of 123, so an Arabic user
                  reading the screen left to right types 456123 and is refused. Copy
                  was never affected — it writes the raw digits — so this only ever
                  bit the read-and-type path, which is the one people use when the
                  code is going into a phone, a VPN client or an SSH prompt. */}
              <div
                dir="ltr"
                className={`font-otp text-2xl tracking-wide transition-colors ${codeColour}`}
              >
                {codeDigits}
              </div>
              {/* Sits directly after the digits rather than pushed to the far right:
                  the icon belongs to the code it copies, and across the width of the
                  card it read as an unrelated control. The label goes after the icon
                  so appearing does not shove the icon sideways. */}
              <div className="flex items-center gap-2">
              </div>
            </div>

          </div>
        </div>

        {/* Outside the code row, so it centres against both lines rather than
            hanging off the end of one. */}
        {ringWithTick()}
      </div>
    </div>
  );
}
