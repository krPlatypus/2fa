import { createT, type Language } from '@/utils/i18n';
import { groupColor, groupIcon, tint } from './group-icons';
import type { GroupStyle } from '@/utils/custom-icons';

export interface GroupCount {
  name: string;
  count: number;
}

interface GroupFilterProps {
  groups: GroupCount[];
  /** How many accounts have no group; the "no group" chip is hidden at 0. */
  ungroupedCount: number;
  totalCount: number;
  /** null — everything; '' — the ungrouped chip; otherwise a group name. */
  active: string | null;
  onChange: (group: string | null) => void;
  language: Language;
  /** Group name to the icon and colour chosen for it in settings. */
  styles?: Record<string, GroupStyle>;
}

/**
 * The filter strip above the account list.
 *
 * Every chip carries its count, including "All". Without it a filtered list is
 * indistinguishable from a shrunken one, and on a 2FA app "some of my accounts
 * are missing" is read as data loss long before it is read as a filter.
 */
export function GroupFilter({
  groups,
  ungroupedCount,
  totalCount,
  active,
  onChange,
  language,
  styles = {},
}: GroupFilterProps) {
  const t = createT(language);

  // The shape and the colour only ever belong to a real group. "All" and "no
  // group" are the absence of one, and giving either its own look would make it
  // read as one.
  const chips: {
    key: string;
    label: string;
    count: number;
    value: string | null;
    icon?: string;
    color?: string;
  }[] = [
    { key: '__all', label: t('groups.all'), count: totalCount, value: null },
    ...groups.map(g => ({
      key: `g:${g.name}`,
      label: g.name,
      count: g.count,
      value: g.name,
      icon: styles[g.name]?.icon,
      color: groupColor(g.name, styles[g.name]),
    })),
  ];

  if (ungroupedCount > 0) {
    chips.push({ key: '__ungrouped', label: t('groups.ungrouped'), count: ungroupedCount, value: '' });
  }

  return (
    // flex-shrink-0: the strip is a flex child of the fixed-height popup, so
    // without it a long account list squeezes the chips until their text is
    // clipped by their own pill.
    <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto scrollbar-hide px-4 py-2 bg-white dark:bg-dark-900 border-b border-gray-200 dark:border-dark-700">
      {chips.map(chip => {
        const isActive = chip.value === active;
        const Icon = groupIcon(chip.icon);
        // A group carries its own colour; All and Ungrouped keep the neutral
        // pair the strip always had. Inline because the colour is data — a
        // Tailwind class cannot be built from a value that only exists at
        // runtime, and the compiler would find nothing to keep.
        const colour = chip.color;
        const style = colour
          ? isActive
            ? { backgroundColor: colour, color: '#ffffff' }
            : { backgroundColor: tint(colour, 0.12), color: colour }
          : undefined;

        return (
          <button
            key={chip.key}
            onClick={() => onChange(chip.value)}
            aria-pressed={isActive}
            style={style}
            className={`flex-shrink-0 max-w-[140px] flex items-center gap-1.5 text-xs font-medium ps-1 pe-2.5 py-1 rounded-full transition-colors ${
              colour
                ? ''
                : isActive
                  ? 'bg-[#4285F4] text-white'
                  : 'bg-gray-100 dark:bg-dark-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-600'
            }`}
          >
            {/* The icon sits in a badge of its own rather than loose in the
                pill: at 12px against a tint of its own colour it disappears,
                and the badge is what gives it an edge to stand on. Padding is
                asymmetric because of it — the badge already carries the space a
                leading padding would have. */}
            {Icon && colour && (
              <span
                className="grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full"
                style={isActive ? { backgroundColor: 'rgba(255,255,255,0.25)' } : { backgroundColor: tint(colour, 0.22) }}
              >
                <Icon size={11} aria-hidden />
              </span>
            )}
            <span className={`truncate ${Icon && colour ? '' : 'ms-1.5'}`}>{chip.label}</span>
            <span className={isActive ? 'opacity-70' : 'opacity-60'}>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}
