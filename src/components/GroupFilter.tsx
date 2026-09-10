import { createT, type Language } from '@/utils/i18n';
import { groupIcon } from './group-icons';

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
  /** Group name to the icon chosen for it in settings. */
  icons?: Record<string, string>;
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
  icons = {},
}: GroupFilterProps) {
  const t = createT(language);

  // The icon only ever belongs to a real group. "All" and "no group" are the
  // absence of one, and giving either a shape would make it look like one.
  const chips: { key: string; label: string; count: number; value: string | null; icon?: string }[] = [
    { key: '__all', label: t('groups.all'), count: totalCount, value: null },
    ...groups.map(g => ({
      key: `g:${g.name}`,
      label: g.name,
      count: g.count,
      value: g.name,
      icon: icons[g.name],
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
        return (
          <button
            key={chip.key}
            onClick={() => onChange(chip.value)}
            aria-pressed={isActive}
            className={`flex-shrink-0 max-w-[140px] flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
              isActive
                ? 'bg-[#4285F4] text-white'
                : 'bg-gray-100 dark:bg-dark-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-600'
            }`}
          >
            {Icon && <Icon size={12} className="flex-shrink-0" aria-hidden />}
            <span className="truncate">{chip.label}</span>
            <span className={isActive ? 'opacity-70' : 'opacity-50'}>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}
